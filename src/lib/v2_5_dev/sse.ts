type SseStreamRunner = (helpers: {
	send: (data: unknown) => void;
	abortSignal: AbortSignal;
}) => Promise<void> | void;

export function createSSEStream(
	runner: SseStreamRunner,
	abortController: AbortController,
	options?: { heartbeatInterval?: number; onHeartbeat?: () => void | Promise<void> }
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const heartbeatInterval = options?.heartbeatInterval ?? 15000;

	return new ReadableStream<Uint8Array>({
		async start(controller) {
			let isActive = true;

			const send = (data: unknown) => {
				if (!isActive) return;
				try {
					const sseData = `data: ${JSON.stringify(data)}\n\n`;
					controller.enqueue(encoder.encode(sseData));
				} catch (e) {
					console.error('Failed to send SSE chunk:', e);
					isActive = false;
				}
			};

			let heartbeat: ReturnType<typeof setInterval> | undefined;
			if (heartbeatInterval > 0) {
				heartbeat = setInterval(() => {
					if (!isActive) {
						if (heartbeat) clearInterval(heartbeat);
						return;
					}
					try {
						controller.enqueue(encoder.encode(': heartbeat\n\n'));
					} catch (e) {
						isActive = false;
						if (heartbeat) clearInterval(heartbeat);
						return;
					}
					const result = options?.onHeartbeat?.();
					if (result && typeof (result as Promise<void>).catch === 'function') {
						(result as Promise<void>).catch((error) => {
							console.error('Heartbeat hook failed:', error);
						});
					}
				}, heartbeatInterval);

				abortController.signal.addEventListener(
					'abort',
					() => {
						isActive = false;
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
				isActive = false;
				if (heartbeat) clearInterval(heartbeat);
				await new Promise(resolve => setTimeout(resolve, 10));
				try {
					controller.close();
				} catch (e) {
				}
			}
		},
		cancel() {
			abortController.abort();
		}
	});
}
