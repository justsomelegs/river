type SseStreamRunner = (helpers: {
	send: (data: unknown) => void;
	abortSignal: AbortSignal;
}) => Promise<void> | void;

export function createSseStream(
	runner: SseStreamRunner,
	abortController: AbortController,
	options?: { heartbeatInterval?: number }
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const heartbeatInterval = options?.heartbeatInterval ?? 15000;

	return new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (data: unknown) => {
				try {
					const sseData = `data: ${JSON.stringify(data)}\n\n`;
					controller.enqueue(encoder.encode(sseData));
				} catch (e) {
					console.error('Failed to send SSE chunk:', e);
				}
			};

			let heartbeat: ReturnType<typeof setInterval> | undefined;
			if (heartbeatInterval > 0) {
				heartbeat = setInterval(() => {
					try {
						controller.enqueue(encoder.encode(': heartbeat\n\n'));
					} catch (e) {
						if (heartbeat) clearInterval(heartbeat);
					}
				}, heartbeatInterval);

				abortController.signal.addEventListener(
					'abort',
					() => {
						if (heartbeat) clearInterval(heartbeat);
					},
					{ once: true }
				);
			}

			try {
				await runner({ send, abortSignal: abortController.signal });
			} catch (e) {
				console.error('Stream runner failed:', e);
			} finally {
				if (heartbeat) clearInterval(heartbeat);
				try {
					controller.close();
				} catch (e) {
					// Already closed, ignore
				}
			}
		},
		cancel() {
			abortController.abort();
		}
	});
}
