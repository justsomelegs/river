import { RIVER_STREAM_EVENT_KEY } from '../types.js';
import type {
	StreamCompletionSummary,
	StreamInfo,
	StreamLifecycleEndEvent,
	StreamLifecycleEvent,
	StreamLifecycleStartEvent
} from '../types.js';
import { createDeferred } from './deferred.js';
import { RiverClientError } from './errors.js';
import type {
	RiverClientLogger,
	RiverClientRetryConfig,
	RiverFetch,
	RiverHttpErrorDetails,
	RiverStreamEvent,
	RiverStreamStatus,
	StreamCallerOptions,
	StreamStartOptions
} from './types.js';
import type { Deferred } from './deferred.js';

type RetryState = {
	attempt: number;
	remaining: number;
};

type SSEFrame = {
	data: string | null;
	event?: string;
	id?: string;
	retry?: number;
	raw: string;
};

export interface StreamCallerDependencies<Input, Chunk> {
	name: string;
	endpoint: string;
	fetchImpl: RiverFetch;
	options: StreamCallerOptions<Chunk>;
	retry?: RiverClientRetryConfig;
	logger?: RiverClientLogger;
	requestInit?: Omit<RequestInit, 'method' | 'body' | 'signal'>;
}

export class InternalRiverStreamCaller<Input, Chunk> {
	status: RiverStreamStatus = 'idle';

	private readonly streamName: string;
	private readonly endpoint: string;
	private readonly fetchImpl: RiverFetch;
	private readonly callbacks: StreamCallerOptions<Chunk>;
	private readonly retryConfig?: RiverClientRetryConfig;
	private readonly logger?: RiverClientLogger;
	private readonly requestInit?: Omit<RequestInit, 'method' | 'body' | 'signal'>;
	private readonly resumeCheckpoints = new Map<string, string>();

	private abortController: AbortController | null = null;
	private currentRunInfo: StreamInfo | null = null;
	private chunkIndex = 0;
	private firstChunkDeferred: Deferred<Chunk> | null = null;
	private completionDeferred: Deferred<StreamCompletionSummary> | null = null;
	private resumeRunId: string | undefined;
	private resumeEventId: string | undefined;
	private lastEventId: string | null = null;
	private serverRetryDelayMs: number | null = null;

	constructor(args: StreamCallerDependencies<Input, Chunk>) {
		this.streamName = args.name;
		this.endpoint = args.endpoint;
		this.fetchImpl = args.fetchImpl;
		this.callbacks = args.options;
		this.retryConfig = args.retry;
		this.logger = args.logger;
		this.requestInit = args.requestInit;
	}

	update(options: StreamCallerOptions<Chunk>) {
		Object.assign(this.callbacks, options);
	}

	start(input: Input, options?: StreamStartOptions): Promise<StreamCompletionSummary> {
		if (this.status === 'running') {
			throw new RiverClientError(`Stream "${this.streamName}" is already running`);
		}

		this.status = 'running';
		this.resumeRunId = options?.runId;
		const inferredEventId =
			options?.lastEventId ??
			(options?.runId ? (this.resumeCheckpoints.get(options.runId) ?? null) : null);
		this.resumeEventId = inferredEventId ?? undefined;
		this.lastEventId = inferredEventId ?? null;
		this.serverRetryDelayMs = null;
		this.abortController = new AbortController();
		this.chunkIndex = 0;
		this.currentRunInfo = null;
		this.firstChunkDeferred = createDeferred<Chunk>();
		// Prevent unhandled rejection warnings when callers never await the first chunk.
		this.firstChunkDeferred.promise.catch(() => {});
		this.completionDeferred = createDeferred<StreamCompletionSummary>();

		void this.invokeCallback(this.callbacks.onStart);

		this.execute(input, {
			attempt: 0,
			remaining: this.retryConfig?.attempts ?? 0
		}).catch((error) => {
			this.handleFatalError(error);
		});

		return this.completionDeferred.promise;
	}

	stop(): void {
		if (this.abortController && this.status === 'running') {
			this.abortController.abort();
		}
	}

	waitForFirstChunk(): Promise<Chunk> {
		if (!this.firstChunkDeferred) {
			throw new RiverClientError('Stream has not been started yet');
		}

		return this.firstChunkDeferred.promise;
	}

	waitForCompletion(): Promise<StreamCompletionSummary> {
		if (!this.completionDeferred) {
			throw new RiverClientError('Stream has not been started yet');
		}

		return this.completionDeferred.promise;
	}

	getLastEventId(): string | null {
		return this.lastEventId;
	}

	private async execute(input: Input, retry: RetryState): Promise<void> {
		try {
			await this.performRequest(input);
		} catch (error) {
			if (this.shouldRetry(error, retry)) {
				await this.delay(this.retryDelayMs(retry.attempt));
				const nextState: RetryState = {
					attempt: retry.attempt + 1,
					remaining: retry.remaining - 1
				};
				await this.execute(input, nextState);
			} else {
				this.handleFatalError(error);
			}
		}
	}

	private async performRequest(input: Input): Promise<void> {
		if (!this.abortController) {
			throw new RiverClientError('Abort controller not initialised');
		}

		const requestBody: { name: string; input: Input; runId?: string } = {
			name: this.streamName,
			input
		};

		if (this.resumeRunId) {
			requestBody.runId = this.resumeRunId;
		}

		const { headers: initHeaders, ...requestInitRest } = this.requestInit ?? {};
		const headers = new Headers(initHeaders ?? {});
		if (!headers.has('Content-Type')) {
			headers.set('Content-Type', 'application/json');
		}
		if (!headers.has('Accept')) {
			headers.set('Accept', 'text/event-stream');
		}
		if (!headers.has('Cache-Control')) {
			headers.set('Cache-Control', 'no-cache');
		}
		if (this.resumeEventId) {
			headers.set('Last-Event-ID', this.resumeEventId);
		}

		const response = await this.fetchImpl(this.endpoint, {
			method: 'POST',
			headers,
			body: JSON.stringify(requestBody),
			signal: this.abortController.signal,
			...requestInitRest
		});

		if (!response.ok) {
			const errorDetails: RiverHttpErrorDetails = {
				status: response.status,
				statusText: response.statusText,
				headers: Object.fromEntries(response.headers.entries())
			};

			try {
				const bodyText = await response.text();
				if (bodyText) {
					const contentType = response.headers.get('content-type') ?? '';
					if (contentType.includes('application/json')) {
						try {
							errorDetails.body = JSON.parse(bodyText);
						} catch {
							errorDetails.body = bodyText;
						}
					} else {
						errorDetails.body = bodyText;
					}
				}
			} catch (error) {
				this.logger?.error?.('Failed to read error response body', {
					error: error instanceof Error ? error.message : error
				});
			}

			throw new RiverClientError(
				`Stream request failed with status ${response.status}`,
				errorDetails
			);
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw new RiverClientError('Stream response body was not readable');
		}

		const decoder = new TextDecoder();
		let buffer = '';
		let finished = false;

		while (!finished) {
			const { value, done } = await reader.read();
			if (done) break;
			if (!value) continue;

			buffer += decoder.decode(value, { stream: true });
			const result = this.processBuffer(buffer, (frame) => this.handleFrame(frame));
			buffer = result.buffer;
			finished = result.finished;
		}

		if (this.status === 'running' && this.completionDeferred && !this.completionDeferred.settled) {
			const summary: StreamCompletionSummary = {
				status: 'success',
				totalChunks: this.chunkIndex,
				durationMs: 0,
				runId: this.currentRunInfo?.runId ?? 'unknown',
				streamId: this.currentRunInfo?.streamId ?? null
			};
			this.resolveCompletion(summary);
		}
	}

	private handleFrame(frame: SSEFrame): boolean {
		if (frame.id) {
			this.lastEventId = frame.id;
			this.rememberCheckpoint(frame.id);
		}

		if (typeof frame.retry === 'number' && frame.retry >= 0) {
			this.serverRetryDelayMs = frame.retry;
			this.logger?.debug?.('Server requested retry delay update', {
				stream: this.streamName,
				delayMs: frame.retry
			});
		}

		if (frame.data === null) {
			void this.invokeCallback(this.callbacks.onEvent, {
				kind: 'other',
				id: frame.id ?? undefined,
				event: frame.event ?? undefined,
				raw: frame.raw,
				data: undefined
			} as RiverStreamEvent<Chunk>);
			return false;
		}

		let payload: unknown = frame.data;
		const trimmed = frame.data.trim();
		const shouldAttemptJson =
			trimmed.startsWith('{') ||
			trimmed.startsWith('[') ||
			trimmed.startsWith('"') ||
			trimmed === 'null' ||
			trimmed === 'true' ||
			trimmed === 'false' ||
			/^-?\d/.test(trimmed);

		if (shouldAttemptJson) {
			try {
				payload = JSON.parse(frame.data);
			} catch (error) {
				this.logger?.error?.('Failed to parse stream payload', {
					error: error instanceof Error ? error.message : error,
					raw: frame.data
				});
			}
		}

		const baseEvent = {
			id: frame.id ?? undefined,
			event: frame.event ?? undefined,
			raw: frame.raw
		};

		if (payload && typeof payload === 'object' && RIVER_STREAM_EVENT_KEY in payload) {
			const lifecycle = payload as StreamLifecycleEvent;
			void this.invokeCallback(this.callbacks.onEvent, {
				kind: 'lifecycle',
				...baseEvent,
				data: lifecycle
			} as RiverStreamEvent<Chunk>);

			if (lifecycle[RIVER_STREAM_EVENT_KEY] === 'stream_start') {
				const event = lifecycle as StreamLifecycleStartEvent;
				this.currentRunInfo = {
					runId: event.runId,
					streamId: event.streamId,
					isResumable: event.isResumable
				};
				void this.invokeCallback(this.callbacks.onStreamInfo, this.currentRunInfo);
				return false;
			}

			if (lifecycle[RIVER_STREAM_EVENT_KEY] === 'stream_end') {
				const event = lifecycle as StreamLifecycleEndEvent;
				const summary: StreamCompletionSummary = {
					status: event.status,
					totalChunks: event.totalChunks,
					durationMs: event.durationMs,
					runId: event.runId,
					streamId: event.streamId
				};
				this.resolveCompletion(summary);
				return true;
			}

			return false;
		}

		if (frame.event && frame.event !== 'message') {
			void this.invokeCallback(this.callbacks.onEvent, {
				kind: 'other',
				...baseEvent,
				data: payload
			} as RiverStreamEvent<Chunk>);
			return false;
		}

		const chunk = payload as Chunk;
		const index = this.chunkIndex;
		this.chunkIndex += 1;
		this.resolveFirstChunk(chunk);

		void this.invokeCallback(this.callbacks.onEvent, {
			kind: 'chunk',
			...baseEvent,
			data: chunk,
			index
		} as RiverStreamEvent<Chunk>);
		void this.invokeCallback(this.callbacks.onChunk, chunk, index);
		return false;
	}

	private resolveFirstChunk(chunk: Chunk) {
		if (this.firstChunkDeferred && !this.firstChunkDeferred.settled) {
			this.firstChunkDeferred.resolve(chunk);
		}
	}

	private resolveCompletion(summary: StreamCompletionSummary) {
		if (!this.completionDeferred || this.completionDeferred.settled) {
			return;
		}

		switch (summary.status) {
			case 'success':
				this.status = 'success';
				break;
			case 'error':
				this.status = 'error';
				break;
			case 'canceled':
				this.status = 'canceled';
				break;
		}

		this.completionDeferred.resolve(summary);

		if (summary.status === 'canceled') {
			void this.invokeCallback(this.callbacks.onCancel);
		} else if (summary.status === 'error') {
			void this.invokeCallback(
				this.callbacks.onError,
				new RiverClientError('Stream completed with error status')
			);
		}

		void this.invokeCallback(this.callbacks.onComplete, summary);
	}

	private handleFatalError(error: unknown) {
		if (this.abortController?.signal.aborted) {
			this.status = 'canceled';
			void this.invokeCallback(this.callbacks.onCancel);
			if (this.completionDeferred && !this.completionDeferred.settled) {
				this.completionDeferred.resolve({
					status: 'canceled',
					totalChunks: this.chunkIndex,
					durationMs: 0,
					runId: this.currentRunInfo?.runId ?? 'unknown',
					streamId: this.currentRunInfo?.streamId ?? null
				});
			}
			return;
		}

		this.status = 'error';
		void this.invokeCallback(this.callbacks.onError, error);

		if (this.firstChunkDeferred && !this.firstChunkDeferred.settled) {
			this.firstChunkDeferred.reject(error);
		}

		if (this.completionDeferred && !this.completionDeferred.settled) {
			this.completionDeferred.reject(error);
		}
	}

	private shouldRetry(_error: unknown, retry: RetryState): boolean {
		if (!this.retryConfig || retry.remaining <= 0) {
			return false;
		}
		if (this.abortController?.signal.aborted) {
			return false;
		}
		return true;
	}

	private retryDelayMs(attempt: number): number {
		if (this.serverRetryDelayMs !== null) {
			return Math.max(0, this.serverRetryDelayMs);
		}
		if (!this.retryConfig) return 0;
		const base = this.retryConfig.delayMs ?? 200;
		if (!this.retryConfig.exponentialBackoff) {
			return base;
		}
		return base * Math.max(1, Math.pow(2, attempt));
	}

	private rememberCheckpoint(eventId: string) {
		const runId = this.extractRunId(eventId);
		if (!runId) return;
		this.resumeCheckpoints.set(runId, eventId);
	}

	private extractRunId(eventId: string | null): string | null {
		if (!eventId) return null;
		const separatorIndex = eventId.lastIndexOf(':');
		if (separatorIndex === -1) {
			return eventId;
		}
		return eventId.slice(0, separatorIndex) || null;
	}

	private processBuffer(
		buffer: string,
		handle: (frame: SSEFrame) => boolean
	): { buffer: string; finished: boolean } {
		const segments = buffer.split('\n\n');
		const remainder = segments.pop() ?? '';

		for (const segment of segments) {
			const cleaned = segment.replace(/\r/g, '');
			if (!cleaned) continue;

			const lines = cleaned.split('\n');
			const dataLines: string[] = [];
			const frame: SSEFrame = {
				data: null,
				raw: cleaned
			};

			for (const line of lines) {
				if (!line || line.startsWith(':')) {
					continue;
				}

				const colonIndex = line.indexOf(':');
				if (colonIndex === -1) {
					continue;
				}

				const field = line.slice(0, colonIndex).trim();
				let value = line.slice(colonIndex + 1);
				if (value.startsWith(' ')) {
					value = value.slice(1);
				}

				switch (field) {
					case 'data':
						dataLines.push(value);
						break;
					case 'event':
						frame.event = value || undefined;
						break;
					case 'id':
						frame.id = value || undefined;
						break;
					case 'retry': {
						const retryDelay = Number.parseInt(value, 10);
						if (!Number.isNaN(retryDelay)) {
							frame.retry = retryDelay;
						}
						break;
					}
					default:
						break;
				}
			}

			frame.data = dataLines.length > 0 ? dataLines.join('\n') : null;
			frame.raw = frame.data ?? cleaned;

			const hasContent =
				frame.data !== null ||
				frame.event !== undefined ||
				frame.id !== undefined ||
				frame.retry !== undefined;

			if (!hasContent) {
				continue;
			}

			const shouldStop = handle(frame);
			if (shouldStop) {
				return { buffer: '', finished: true };
			}
		}

		return { buffer: remainder, finished: false };
	}

	private delay(ms: number): Promise<void> {
		if (ms <= 0) return Promise.resolve();
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private async invokeCallback<T extends any[]>(
		callback?: (...args: T) => void | Promise<void>,
		...args: T
	) {
		if (!callback) return;

		try {
			await callback(...args);
		} catch (error) {
			this.logger?.error?.('Stream callback threw an error', {
				stream: this.streamName,
				error: error instanceof Error ? error.message : error
			});
		}
	}
}
