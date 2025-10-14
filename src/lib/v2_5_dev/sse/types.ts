export interface SSESession {
	readonly signal: AbortSignal;
	sendData: (data: unknown, options?: { event?: string; id?: string }) => void;
	sendEvent: (event: string, data?: unknown, options?: { id?: string }) => void;
	sendComment: (comment: string) => void;
	sendRetry: (delayMs: number) => void;
	sendRaw: (payload: string) => void;
	close: () => void;
}

export type SSEStreamHandler = (session: SSESession) => Promise<void> | void;

export interface HeartbeatOptions {
	intervalMs: number;
	comment?: string;
	onBeat?: () => void | Promise<void>;
}

export interface RetryOptions {
	delayMs: number;
}

export interface CreateSSEStreamOptions {
	encoder?: (payload: unknown) => string;
	heartbeat?: HeartbeatOptions | false;
	retry?: RetryOptions | false;
	onClientAbort?: () => void | Promise<void>;
}

export interface SSEStream {
	stream: ReadableStream<Uint8Array>;
	toResponse: (headers?: HeadersInit) => Response;
}
