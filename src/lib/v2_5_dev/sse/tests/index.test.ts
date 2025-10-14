import { describe, expect, it, vi } from 'vitest';

import { createSSEStream } from '../index.js';

const decodeStream = async (readable: ReadableStream<Uint8Array>) => {
	const reader = readable.getReader();
	const decoder = new TextDecoder();
	let result = '';
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		if (value) {
			result += decoder.decode(value);
		}
	}
	return result;
};

describe('createSSEStream', () => {
	it('emits data, event, comments, and retry directives', async () => {
		const stream = createSSEStream(async (session) => {
			session.sendData({ hello: 'world' });
			session.sendEvent('custom', { value: 1 });
			session.sendComment('keep-alive');
			session.sendRetry(3000);
			session.close();
		});

		const text = await decodeStream(stream.stream);
		expect(text).toContain('data: {"hello":"world"}');
		expect(text).toContain('event: custom');
		expect(text).toContain('data: {"value":1}');
		expect(text).toContain(': keep-alive');
		expect(text).toContain('retry: 3000');
	});

	it('supports heartbeat intervals and aborts gracefully', async () => {
		const onBeat = vi.fn();
		const controller = new AbortController();
		const stream = createSSEStream(
			async () => {
				await new Promise((resolve) => setTimeout(resolve, 30));
			},
			controller,
			{
				heartbeat: {
					intervalMs: 20,
					onBeat
				}
			}
		);

		const readPromise = decodeStream(stream.stream);
		await new Promise((resolve) => setTimeout(resolve, 75));
		controller.abort();
		await readPromise;
		expect(onBeat).toHaveBeenCalled();
	});
});
