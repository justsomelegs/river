import type {
	StreamChunkType,
	StreamCompletionSummary,
	StreamDefinitionMap,
	StreamInfo,
	StreamInputType,
	StreamLifecycleEvent
} from '../types.js';

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

export interface RiverHttpErrorDetails {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body?: unknown;
}

export type RiverStreamEvent<Chunk> =
	| {
			kind: 'chunk';
			index: number;
			id?: string;
			event?: string;
			raw: string | null;
			data: Chunk;
	  }
	| {
			kind: 'lifecycle';
			id?: string;
			event?: string;
			raw: string | null;
			data: StreamLifecycleEvent;
	  }
	| {
			kind: 'other';
			id?: string;
			event?: string;
			raw: string | null;
			data: unknown;
	  };

export interface StreamStartOptions {
	runId?: string;
	lastEventId?: string;
}

export type StreamCallerOptions<Chunk> = {
	onStart?: () => void | Promise<void>;
	onChunk?: (chunk: Chunk, index: number) => void | Promise<void>;
	onError?: (error: unknown) => void | Promise<void>;
	onComplete?: (summary: StreamCompletionSummary) => void | Promise<void>;
	onCancel?: () => void | Promise<void>;
	onStreamInfo?: (info: StreamInfo) => void | Promise<void>;
	onEvent?: (event: RiverStreamEvent<Chunk>) => void | Promise<void>;
};

export interface RiverClientConfig {
	endpoint: string;
	fetch?: RiverFetch;
	retry?: RiverClientRetryConfig;
	logger?: RiverClientLogger;
	requestInit?: Omit<RequestInit, 'method' | 'body' | 'signal'>;
}

export interface RiverStreamCaller<Input, Chunk> {
	readonly status: RiverStreamStatus;
	start: (input: Input, options?: StreamStartOptions) => Promise<StreamCompletionSummary>;
	stop: () => void;
	waitForFirstChunk: () => Promise<Chunk>;
	waitForCompletion: () => Promise<StreamCompletionSummary>;
	update: (options: StreamCallerOptions<Chunk>) => void;
	getLastEventId: () => string | null;
}

export type RiverStreamFactory<R extends StreamDefinitionMap> = {
	[K in keyof R]: (
		options?: StreamCallerOptions<StreamChunkType<R[K]>>
	) => RiverStreamCaller<StreamInputType<R[K]>, StreamChunkType<R[K]>>;
};

export interface RiverClient<R extends StreamDefinitionMap> {
	stream: RiverStreamFactory<R>;
}
