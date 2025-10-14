import { createSSEStream } from '../../sse/index.js';
import type {
	AbortSummary,
	BaseStreamContext,
	ChunkMeta,
	RiverServerConfig as RiverServerOptions,
	StreamLifecycleStartEvent,
	StreamDefinition,
	StreamInfo,
	StreamLifecycleEndEvent,
	StreamRunStatus,
	StreamStorageAdapter,
	StreamRunWriter,
	StreamRunner,
	StoredRun
} from '../../types.js';
import type { PluginManager } from './plugin-manager.js';
import { RIVER_STREAM_EVENT_KEY } from '../../types.js';

interface StreamExecutionArgs {
	streamName: string;
	definition: StreamDefinition<any, any, any>;
	runId: string;
	parsedInput: unknown;
	baseMeta: BaseStreamContext;
	extendedContext: Record<string, unknown>;
	runner: StreamRunner<any, any, any>;
	storageAdapter: StreamStorageAdapter<any>;
	pluginManager: PluginManager;
	serverOptions: RiverServerOptions;
	corsHeaders: Record<string, string>;
	abortController: AbortController;
	resume?: {
		storedRun: StoredRun<any> | null;
		lastEventId: string | null;
	};
}

export function createStreamResponse({
	streamName,
	definition,
	runId,
	parsedInput,
	baseMeta,
	extendedContext,
	runner,
	storageAdapter,
	pluginManager,
	serverOptions,
	corsHeaders,
	abortController,
	resume
}: StreamExecutionArgs): Response {
	const storedRun = resume?.storedRun ?? null;
	const storedChunks = storedRun?.chunks ?? [];
	const initialChunkCount = storedChunks.length;

	const eventIdForSequence = (sequence: number) => `${runId}:${sequence}`;

	const parseLastEventSequence = (id: string | null): number | null => {
		if (!id) return null;
		const trimmed = id.trim();
		if (!trimmed) return null;

		const splitIndex = trimmed.lastIndexOf(':');
		if (splitIndex > -1) {
			const prefix = trimmed.slice(0, splitIndex);
			const suffix = trimmed.slice(splitIndex + 1);
			if (prefix === runId) {
				const parsed = Number.parseInt(suffix, 10);
				return Number.isNaN(parsed) ? null : parsed;
			}
		}

		const fallback = Number.parseInt(trimmed, 10);
		return Number.isNaN(fallback) ? null : fallback;
	};

	const lastDeliveredSequence = parseLastEventSequence(resume?.lastEventId ?? null);
	const shouldSendSequence = (sequence: number) =>
		lastDeliveredSequence === null || sequence > lastDeliveredSequence;

	const { stream, toResponse } = createSSEStream(
		async (session) => {
			const { signal: abortSignal } = session;
			const runStartedAt = new Date();
			const storageContext = {
				runId,
				streamName,
				definition,
				startedAt: runStartedAt,
				attributes: {}
			};

			let storageWriter: StreamRunWriter<any>;
			try {
				storageWriter = await storageAdapter.openRun(storageContext);
			} catch (error) {
				console.error(
					`Stream "${streamName}" failed to open storage adapter "${storageAdapter.id}":`,
					error
				);
				throw error;
			}

			const streamInfo: StreamInfo = {
				runId,
				streamId: storageWriter.streamId ?? null,
				isResumable: storageAdapter.capabilities.resumable
			};

			await pluginManager.notifyStreamInfo(streamInfo, streamName);

			const startEvent: StreamLifecycleStartEvent = {
				[RIVER_STREAM_EVENT_KEY]: 'stream_start',
				runId: streamInfo.runId,
				streamId: streamInfo.streamId,
				isResumable: streamInfo.isResumable
			};

			session.sendData(startEvent, { id: eventIdForSequence(0) });

			if (storedChunks.length > 0) {
				for (let index = 0; index < storedChunks.length; index++) {
					const sequence = index + 1;
					if (!shouldSendSequence(sequence)) continue;
					session.sendData(storedChunks[index] as unknown, { id: eventIdForSequence(sequence) });
				}
			}

			let status: StreamRunStatus = 'success';
			let chunkCount = initialChunkCount;
			const startTime = runStartedAt.getTime();
			const throttleMs =
				typeof definition.throttleMs === 'number' && definition.throttleMs > 0
					? definition.throttleMs
					: 0;
			let lastEmittedAt = 0;
			let emitQueue: Promise<void> = Promise.resolve();
			let failureReason: unknown;
			let abortReason: AbortSummary['reason'] | undefined;

			const failStream = (error: unknown) => {
				status = 'error';
				failureReason = error;
				console.error(`Stream "${streamName}" emit failed:`, error);
				if (!abortSignal.aborted) {
					abortController.abort();
				}
			};

			const emitInternal = async (chunk: unknown): Promise<void> => {
				if (throttleMs > 0) {
					const now = Date.now();
					const elapsed = now - lastEmittedAt;
					if (lastEmittedAt && elapsed < throttleMs) {
						await new Promise((resolve) => setTimeout(resolve, throttleMs - elapsed));
					}
					lastEmittedAt = Date.now();
				}

				const validation = definition.chunkSchema['~standard'].validate(chunk);
				const validationResult = validation instanceof Promise ? await validation : validation;
				if (validationResult.issues) {
					failStream(validationResult.issues);
					return;
				}

				const transformed = pluginManager.processChunk(validationResult.value, streamName);

				const emittedAt = new Date();
				const meta: ChunkMeta = {
					index: chunkCount,
					emittedAt,
					ingressLatencyMs: Math.max(0, emittedAt.getTime() - startTime)
				};

				const sequence = chunkCount + 1;

				await storageWriter.append(transformed, meta);
				chunkCount += 1;
				session.sendData(transformed, { id: eventIdForSequence(sequence) });
			};

			const scheduleEmit = (chunk: unknown) => {
				emitQueue = emitQueue.then(() => emitInternal(chunk)).catch(failStream);
			};

			try {
				await runner({
					input: parsedInput,
					appendChunk: (chunk: unknown) => {
						scheduleEmit(chunk);
					},
					meta: baseMeta,
					abortSignal,
					runId,
					...extendedContext
				});

				if (abortSignal.aborted) {
					status = 'canceled';
					abortReason = abortReason ?? 'client_disconnect';
				}
			} catch (error) {
				if (abortSignal.aborted) {
					status = 'canceled';
					abortReason = 'client_disconnect';
				} else {
					status = 'error';
					failureReason = error;
					console.error(`Stream "${streamName}" failed:`, error);
				}
			} finally {
				await emitQueue;
				await storageWriter.flush?.();

				const finishedAt = new Date();
				const durationMs = Math.max(0, finishedAt.getTime() - startTime);
				const endEvent: StreamLifecycleEndEvent = {
					[RIVER_STREAM_EVENT_KEY]: 'stream_end',
					runId: streamInfo.runId,
					streamId: streamInfo.streamId,
					status,
					totalChunks: chunkCount,
					durationMs
				};

				const endSequence = chunkCount + 1;
				session.sendData(endEvent, { id: eventIdForSequence(endSequence) });

				if (status === 'error') {
					const error =
						failureReason ?? new Error(`Stream "${streamName}" failed without error reason`);
					await storageWriter.fail({
						status: 'error',
						totalChunks: chunkCount,
						durationMs,
						finishedAt,
						error
					});
				} else if (
					status === 'canceled' &&
					storageAdapter.capabilities.abortable &&
					typeof storageWriter.abort === 'function'
				) {
					await storageWriter.abort({
						status: 'canceled',
						totalChunks: chunkCount,
						durationMs,
						finishedAt,
						reason: abortReason ?? 'canceled'
					});
				} else {
					await storageWriter.complete({
						status: status === 'success' ? 'success' : 'canceled',
						totalChunks: chunkCount,
						durationMs,
						finishedAt
					});
				}

				await pluginManager.notifyStreamFinished(status, endEvent, streamName);

				if (definition.afterRun) {
					try {
						await definition.afterRun({
							status,
							runId,
							meta: baseMeta,
							...extendedContext
						});
					} catch (error) {
						console.error(`afterRun hook failed for "${streamName}":`, error);
					}
				}
			}
		},
		abortController,
		{
			heartbeat: serverOptions.heartbeatInterval
				? {
						intervalMs: serverOptions.heartbeatInterval,
						onBeat: () => pluginManager.notifyHeartbeat(streamName)
					}
				: false
		}
	);

	return toResponse({
		'X-Accel-Buffering': 'no',
		...corsHeaders
	});
}
