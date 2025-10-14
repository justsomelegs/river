import { describe, expect, it, vi } from 'vitest';

import { InternalRiverStreamCaller } from '../stream-caller.js';
import type { StreamCallerOptions } from '../types.js';

const encoder = new TextEncoder();

const sse = (...messages: string[]) => messages.join('\n\n') + '\n\n';

const lifecycleStart = JSON.stringify({
	__river_stream_event__: 'stream_start',
	runId: 'run-123',
	streamId: null,
	isResumable: true
});

const lifecycleEnd = JSON.stringify({
	__river_stream_event__: 'stream_end',
	runId: 'run-123',
	streamId: null,
	status: 'success',
	totalChunks: 1,
	durationMs: 5
});

const withResponse = (payload: string) =>
	new Response(
		new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(payload));
				controller.close();
			}
		}),
		{
			status: 200,
			headers: { 'Content-Type': 'text/event-stream' }
		}
	);

const createCaller = (options: StreamCallerOptions<string> = {}) =>
	new InternalRiverStreamCaller<string, string>({
		name: 'test',
		endpoint: 'https://example.com/stream',
		fetchImpl: globalThis.fetch,
		options,
		logger: {
			error: vi.fn(),
			debug: vi.fn()
		}
	});

describe('InternalRiverStreamCaller', () => {
	it('sets SSE-friendly request headers and parses lifecycle/chunk events', async () => {
		const fetchMock = vi.fn(async () =>
			withResponse(sse(`data: ${lifecycleStart}`, 'data: "chunk-1"', `data: ${lifecycleEnd}`))
		);

		(globalThis.fetch as unknown) = fetchMock as unknown as typeof fetch;

		const events: string[] = [];
		const caller = createCaller({
			onChunk: (chunk) => {
				events.push(`chunk:${chunk}`);
			},
			onEvent: (event) => {
				events.push(`event:${event.kind}`);
			}
		});

		const completion = await caller.start('payload');
		expect(completion.status).toBe('success');
		expect(events).toEqual(['event:lifecycle', 'event:chunk', 'chunk:chunk-1', 'event:lifecycle']);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [, requestInit] = fetchMock.mock.calls[0]! as unknown as [RequestInfo | URL, RequestInit];
		const headers = new Headers(requestInit?.headers as HeadersInit);
		expect(headers.get('Content-Type')).toBe('application/json');
		expect(headers.get('Accept')).toBe('text/event-stream');
		expect(headers.get('Cache-Control')).toBe('no-cache');

		const body = requestInit?.body as string;
		expect(JSON.parse(body)).toMatchObject({
			name: 'test',
			input: 'payload'
		});

		expect(caller.getLastEventId()).toBeNull();
	});

	it('resumes with Last-Event-ID and tracks latest id', async () => {
		const fetchMock = vi.fn(async () =>
			withResponse(
				sse(
					`id: 09\ndata: ${lifecycleStart}`,
					`id: 10\ndata: "chunk-1"`,
					`id: 11\ndata: ${lifecycleEnd}`
				)
			)
		);
		(globalThis.fetch as unknown) = fetchMock as unknown as typeof fetch;

		const caller = createCaller();
		await caller.start('payload', { lastEventId: '05' });

		const [, requestInit] = fetchMock.mock.calls[0]! as unknown as [RequestInfo | URL, RequestInit];
		const headers = new Headers(requestInit?.headers as HeadersInit);
		expect(headers.get('Last-Event-ID')).toBe('05');

		expect(caller.getLastEventId()).toBe('11');
	});

	it('retries on failure up to configured attempts', async () => {
		const failingResponse = new Response(null, { status: 500, statusText: 'oops' });
		const successResponse = withResponse(
			sse(
				`data: ${lifecycleStart}`,
				'event: message\ndata: "retry-success"',
				`data: ${lifecycleEnd}`
			)
		);
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(failingResponse)
			.mockResolvedValueOnce(successResponse);

		(globalThis.fetch as unknown) = fetchMock as unknown as typeof fetch;

		const caller = new InternalRiverStreamCaller<string, string>({
			name: 'retry-stream',
			endpoint: 'https://example.com/stream',
			fetchImpl: globalThis.fetch,
			options: {},
			retry: { attempts: 1, delayMs: 50 },
			logger: {
				error: vi.fn(),
				debug: vi.fn()
			}
		});

		const completion = await caller.start('payload');
		expect(completion.status).toBe('success');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('surfaces HTTP error details when non-OK response is received', async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(JSON.stringify({ error: 'bad' }), {
					status: 400,
					statusText: 'bad request',
					headers: { 'Content-Type': 'application/json' }
				})
		);
		(globalThis.fetch as unknown) = fetchMock as unknown as typeof fetch;

		const caller = createCaller();
		const promise = caller.start('payload');
		await expect(promise).rejects.toMatchObject({
			message: 'Stream request failed with status 400',
			cause: expect.objectContaining({ status: 400, body: { error: 'bad' } })
		});
		await promise.catch(() => {});
	});
});
