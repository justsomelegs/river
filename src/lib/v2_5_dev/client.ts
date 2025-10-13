import {
    RIVER_STREAM_EVENT_KEY
} from './types.js';
import type {
    StreamChunkType,
    StreamCompletionSummary,
    StreamDefinitionMap,
    StreamInfo,
    StreamInputType,
    StreamLifecycleEndEvent,
    StreamLifecycleEvent,
    StreamLifecycleStartEvent,
    StreamRunStatus
} from './types.js';

export type RiverStreamStatus = 'idle' | 'running' | 'success' | 'error' | 'canceled';

export type RiverFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RiverClientRetryConfig {
    attempts: number;
    delayMs?: number;
    exponentialBackoff?: boolean;
}

export interface RiverClientLogger {
    debug?: (message: string, details?: Record<string, unknown>) => void;
    error?: (message: string, details?: Record<string, unknown>) => void;
}

export type StreamCallerOptions<Chunk> = {
    onStart?: () => void | Promise<void>;
    onChunk?: (chunk: Chunk, index: number) => void | Promise<void>;
    onError?: (error: unknown) => void | Promise<void>;
    onComplete?: (summary: StreamCompletionSummary) => void | Promise<void>;
    onCancel?: () => void | Promise<void>;
    onStreamInfo?: (info: StreamInfo) => void | Promise<void>;
};

interface RiverClientConfig {
    endpoint: string;
    fetch?: RiverFetch;
    retry?: RiverClientRetryConfig;
    logger?: RiverClientLogger;
    requestInit?: Omit<RequestInit, 'method' | 'body' | 'signal'>;
}

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
    settled: boolean;
}

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    let settled = false;
    const promise = new Promise<T>((res, rej) => {
        resolve = (value) => {
            settled = true;
            res(value);
        };
        reject = (reason) => {
            settled = true;
            rej(reason);
        };
    });
    return { promise, resolve, reject, get settled() { return settled; } } as Deferred<T>;
}

class RiverClientError extends Error {
    cause: unknown;
    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = 'RiverClientError';
        this.cause = cause;
    }
}

type CompletionResolver = {
    resolve: (summary: StreamCompletionSummary) => void;
    reject: (error: unknown) => void;
};

type RetryState = {
    attempt: number;
    remaining: number;
};

class InternalRiverStreamCaller<Input, Chunk> {
    status: RiverStreamStatus = 'idle';

    private readonly streamName: string;
    private readonly endpoint: string;
    private readonly fetchImpl: RiverFetch;
    private readonly callbacks: StreamCallerOptions<Chunk>;
    private readonly retryConfig?: RiverClientRetryConfig;
    private readonly logger?: RiverClientLogger;
    private readonly requestInit?: Omit<RequestInit, 'method' | 'body' | 'signal'>;

    private abortController: AbortController | null = null;
    private currentRunInfo: StreamInfo | null = null;
    private chunkIndex = 0;
    private lastChunkTimestamp = 0;
    private firstChunkDeferred: Deferred<Chunk> | null = null;
    private completionDeferred: Deferred<StreamCompletionSummary> | null = null;
    private activeExecution: Promise<void> | null = null;
    private resumeRunId: string | undefined;

    constructor(args: {
        name: string;
        endpoint: string;
        fetchImpl: RiverFetch;
        options: StreamCallerOptions<Chunk>;
        retry?: RiverClientRetryConfig;
        logger?: RiverClientLogger;
        requestInit?: Omit<RequestInit, 'method' | 'body' | 'signal'>;
    }) {
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

    start(input: Input, options?: { runId?: string }): Promise<StreamCompletionSummary> {
        if (this.status === 'running') {
            throw new RiverClientError(`Stream "${this.streamName}" is already running`);
        }

        this.status = 'running';
        this.resumeRunId = options?.runId;
        this.abortController = new AbortController();
        this.chunkIndex = 0;
        this.currentRunInfo = null;
        this.firstChunkDeferred = createDeferred<Chunk>();
        this.completionDeferred = createDeferred<StreamCompletionSummary>();

        void this.invokeCallback(this.callbacks.onStart);

        this.activeExecution = this.execute(input, {
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

        const response = await this.fetchImpl(this.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.requestInit?.headers
            },
            body: JSON.stringify(requestBody),
            signal: this.abortController.signal,
            credentials: this.requestInit?.credentials,
            cache: this.requestInit?.cache,
            referrerPolicy: this.requestInit?.referrerPolicy,
            mode: this.requestInit?.mode
        });

        if (!response.ok) {
            throw new RiverClientError(
                `Stream request failed with status ${response.status}`,
                { status: response.status, statusText: response.statusText }
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
            if (done) {
                break;
            }
            if (!value) {
                continue;
            }

            buffer += decoder.decode(value, { stream: true });
            const result = this.processBuffer(buffer, (raw) => this.handleMessage(raw));
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

    private handleMessage(raw: string): boolean {
        let payload: unknown = raw;
        try {
            payload = JSON.parse(raw);
        } catch (error) {
            this.logger?.error?.('Failed to parse stream payload', { error: error instanceof Error ? error.message : error, raw });
        }

        if (payload && typeof payload === 'object' && RIVER_STREAM_EVENT_KEY in payload) {
            const lifecycle = payload as StreamLifecycleEvent;
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
        }

        const chunk = payload as Chunk;
        this.chunkIndex += 1;
        this.resolveFirstChunk(chunk);
        void this.invokeCallback(this.callbacks.onChunk, chunk, this.chunkIndex - 1);
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
            void this.invokeCallback(this.callbacks.onError, new RiverClientError('Stream completed with error status'));
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

    private shouldRetry(error: unknown, retry: RetryState): boolean {
        if (!this.retryConfig || retry.remaining <= 0) {
            return false;
        }
        if (this.abortController?.signal.aborted) {
            return false;
        }
        return true;
    }

    private retryDelayMs(attempt: number): number {
        if (!this.retryConfig) return 0;
        const base = this.retryConfig.delayMs ?? 200;
        if (!this.retryConfig.exponentialBackoff) {
            return base;
        }
        return base * Math.max(1, Math.pow(2, attempt));
    }

    private processBuffer(buffer: string, handle: (raw: string) => boolean): { buffer: string; finished: boolean } {
        const segments = buffer.split('\n\n');
        let remainder = segments.pop() ?? '';
        for (const segment of segments) {
            const trimmed = segment.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;
            const lines = trimmed.split('\n');
            for (const line of lines) {
                if (!line.startsWith('data:')) continue;
                const raw = line.slice(5).trim();
                if (!raw) continue;
                const shouldStop = handle(raw);
                if (shouldStop) {
                    return { buffer: '', finished: true };
                }
            }
        }
        return { buffer: remainder, finished: false };
    }

    private delay(ms: number): Promise<void> {
        if (ms <= 0) return Promise.resolve();
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private async invokeCallback<T extends any[]>(callback?: (...args: T) => void | Promise<void>, ...args: T) {
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

type RiverStreamFactory<R extends StreamDefinitionMap> = {
    [K in keyof R]: (
        options?: StreamCallerOptions<StreamChunkType<R[K]>>
    ) => RiverStreamCaller<StreamInputType<R[K]>, StreamChunkType<R[K]>>;
};

export interface RiverStreamCaller<Input, Chunk> {
    readonly status: RiverStreamStatus;
    start: (input: Input, options?: { runId?: string }) => Promise<StreamCompletionSummary>;
    stop: () => void;
    waitForFirstChunk: () => Promise<Chunk>;
    waitForCompletion: () => Promise<StreamCompletionSummary>;
    update: (options: StreamCallerOptions<Chunk>) => void;
}

export type RiverClient<R extends StreamDefinitionMap> = {
    stream: RiverStreamFactory<R>;
};

export function createRiverClient<R extends StreamDefinitionMap>(config: RiverClientConfig): RiverClient<R> {
    const fetchImpl: RiverFetch = config.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!fetchImpl) {
        throw new RiverClientError('Global fetch is not available and no fetch implementation was provided');
    }

    const createInvoker = <K extends keyof R>(streamName: K) => (options: StreamCallerOptions<StreamChunkType<R[K]>> = {}) => {
        const caller = new InternalRiverStreamCaller<StreamInputType<R[K]>, StreamChunkType<R[K]>>({
            name: streamName as string,
            endpoint: config.endpoint,
            fetchImpl,
            options,
            retry: config.retry,
            logger: config.logger,
            requestInit: config.requestInit
        });

        const streamCaller: RiverStreamCaller<StreamInputType<R[K]>, StreamChunkType<R[K]>> = {
            get status() {
                return caller.status;
            },
            start: (input: StreamInputType<R[K]>, options?: { runId?: string }) => caller.start(input, options),
            stop: () => caller.stop(),
            waitForFirstChunk: () => caller.waitForFirstChunk(),
            waitForCompletion: () => caller.waitForCompletion(),
            update: (opts: StreamCallerOptions<StreamChunkType<R[K]>>) => caller.update(opts)
        };

        return streamCaller;
    };

    const handler: ProxyHandler<RiverStreamFactory<R>> = {
        get(_target, prop) {
            return typeof prop === 'string' ? createInvoker(prop as keyof R) : undefined;
        }
    };

    const streamFactory = new Proxy({} as RiverStreamFactory<R>, handler);

    return {
        stream: streamFactory
    };
}
