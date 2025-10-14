import type {
	CreateSSEStreamOptions,
	HeartbeatOptions,
	RetryOptions,
	SSESession,
	SSEStream,
	SSEStreamHandler
} from './types.js';

const DEFAULT_HEADERS: Record<string, string> = {
	'Content-Type': 'text/event-stream',
	'Cache-Control': 'no-cache',
	Connection: 'keep-alive'
};

export function createSSEStream(
	handler: SSEStreamHandler,
	options?: CreateSSEStreamOptions
): SSEStream;
export function createSSEStream(
	handler: SSEStreamHandler,
	abortController: AbortController,
	options?: CreateSSEStreamOptions
): SSEStream;
export function createSSEStream(
	handler: SSEStreamHandler,
	arg2?: AbortController | CreateSSEStreamOptions,
	arg3?: CreateSSEStreamOptions
): SSEStream {
	let controller: AbortController;
	let options: CreateSSEStreamOptions | undefined;

	if (arg2 instanceof AbortController) {
		controller = arg2;
		options = arg3;
	} else {
		controller = new AbortController();
		options = arg2;
	}

	const textEncoder = new TextEncoder();
	const encodeData =
		options?.encoder ??
		((payload: unknown) => (typeof payload === 'string' ? payload : JSON.stringify(payload)));

	const heartbeatConfig: HeartbeatOptions | undefined =
		options?.heartbeat === false ? undefined : options?.heartbeat;
	const retryConfig: RetryOptions | undefined =
		options?.retry === false ? undefined : options?.retry;

	let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

	const stream = new ReadableStream<Uint8Array>({
		start(controllerStream) {
			let closed = false;
			let abortListener: (() => void) | null = null;

			const finish = (reason: 'abort' | 'close') => {
				if (closed) return;
				closed = true;
				if (heartbeatTimer) {
					clearInterval(heartbeatTimer);
					heartbeatTimer = undefined;
				}
				if (abortListener) {
					controller.signal.removeEventListener('abort', abortListener);
					abortListener = null;
				}
				if (reason === 'abort') {
					Promise.resolve(options?.onClientAbort?.()).catch((error) => {
						console.error('SSE client abort handler failed:', error);
					});
				}
				try {
					controllerStream.close();
				} catch {
					// ignore closing errors
				}
			};

			const write = (payload: string) => {
				if (closed || controller.signal.aborted) return;
				try {
					controllerStream.enqueue(textEncoder.encode(payload));
				} catch (error) {
					console.error('Failed to enqueue SSE payload:', error);
					finish('close');
				}
			};

			const emitLines = (lines: string[]) => {
				if (lines.length === 0) return;
				write(`${lines.join('\n')}\n\n`);
			};

			const session: SSESession = {
				signal: controller.signal,
				sendData(data, opts) {
					const lines: string[] = [];
					if (opts?.id) {
						lines.push(`id: ${opts.id}`);
					}
					if (opts?.event) {
						lines.push(`event: ${opts.event}`);
					}

					const encoded = encodeData(data);
					const dataLines = encoded.split(/\r?\n/);
					for (const line of dataLines) {
						lines.push(`data: ${line}`);
					}

					emitLines(lines);
				},
				sendEvent(event, data, opts) {
					this.sendData(data ?? '', { ...opts, event });
				},
				sendComment(comment) {
					write(`: ${comment}\n\n`);
				},
				sendRetry(delayMs) {
					write(`retry: ${Math.max(0, Math.floor(delayMs))}\n\n`);
				},
				sendRaw(payload) {
					write(payload.endsWith('\n') ? payload : `${payload}\n`);
				},
				close() {
					finish('close');
				}
			};

			abortListener = () => finish('abort');
			controller.signal.addEventListener('abort', abortListener);

			if (retryConfig) {
				session.sendRetry(retryConfig.delayMs);
			}

			if (heartbeatConfig && heartbeatConfig.intervalMs > 0) {
				heartbeatTimer = setInterval(() => {
					if (controller.signal.aborted || closed) return;
					session.sendComment(heartbeatConfig.comment ?? 'heartbeat');
					if (heartbeatConfig.onBeat) {
						Promise.resolve(heartbeatConfig.onBeat()).catch((error) => {
							console.error('SSE heartbeat hook failed:', error);
						});
					}
				}, heartbeatConfig.intervalMs);
			}

			Promise.resolve(handler(session))
				.catch((error) => {
					console.error('SSE handler failed:', error);
				})
				.finally(() => {
					finish('close');
				});
		},
		cancel() {
			controller.abort();
		}
	});

	return {
		stream,
		toResponse(headers) {
			const finalHeaders = new Headers(DEFAULT_HEADERS);
			if (headers) {
				for (const [key, value] of new Headers(headers)) {
					finalHeaders.set(key, value);
				}
			}
			return new Response(stream, { headers: finalHeaders });
		}
	};
}

export type { CreateSSEStreamOptions, SSESession, SSEStream, SSEStreamHandler } from './types.js';
