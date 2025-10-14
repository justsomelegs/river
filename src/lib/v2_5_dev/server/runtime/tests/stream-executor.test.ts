import { describe, expect, it, vi } from 'vitest';

import { createStreamResponse } from '../stream-executor.js';
import type {
	BaseStreamContext,
	StreamDefinition,
	StreamStorageAdapter,
	StreamRunWriter
} from '../../../types.js';
import type { StandardSchemaV1 } from '../../../core/standard-schema.js';

const stringSchema: StandardSchemaV1<unknown, string> = {
	'~standard': {
		version: 1,
		vendor: 'test',
		validate: (value: unknown) =>
			({
				value: String(value)
			}) as StandardSchemaV1.SuccessResult<string>
	}
};

const failureSchema: StandardSchemaV1<unknown, string> = {
	'~standard': {
		version: 1,
		vendor: 'test',
		validate: () =>
			({
				issues: [{ message: 'invalid' }]
			}) as StandardSchemaV1.FailureResult
	}
};

const createStorageAdapter = <Chunk>(
	writer: StreamRunWriter<Chunk>
): StreamStorageAdapter<Chunk> => ({
	id: 'test-adapter',
	capabilities: {
		resumable: true,
		listable: false,
		purgeable: false
	},
	openRun: vi.fn(async () => writer)
});

const createBaseMeta = (): BaseStreamContext => ({
	event: {
		request: new Request('https://example.com')
	} as any
});

describe('createStreamResponse', () => {
	it('streams lifecycle events, persists chunks, and notifies plugins', async () => {
		const appendCalls: unknown[] = [];
		const complete = vi.fn();
		const writer: StreamRunWriter<string> = {
			streamId: 'storage-stream',
			append: vi.fn(async (chunk) => {
				appendCalls.push(chunk);
			}),
			complete: async (summary) => {
				complete(summary);
			},
			fail: vi.fn(async () => {}),
			abort: vi.fn(async () => {})
		};

		const storageAdapter = createStorageAdapter(writer);

		const pluginManager = {
			notifyStreamInfo: vi.fn(),
			processChunk: vi.fn((chunk: string) => `processed-${chunk}`),
			notifyStreamFinished: vi.fn(),
			notifyRequest: vi.fn(),
			applyRunnerWrappers: vi.fn(),
			buildExtendedContext: vi.fn(),
			notifyHeartbeat: vi.fn()
		};

		const afterRun = vi.fn();

		const definition: StreamDefinition<string, string, { ctx: boolean }> = {
			name: 'demo',
			chunkSchema: stringSchema,
			inputSchema: stringSchema,
			runner: vi.fn(async ({ appendChunk, ctx }) => {
				expect(ctx).toBe(true);
				appendChunk('raw');
			}),
			afterRun,
			use: []
		};

		const response = createStreamResponse({
			streamName: 'demo',
			definition,
			runId: 'run-1',
			parsedInput: 'input',
			baseMeta: createBaseMeta(),
			extendedContext: { ctx: true },
			runner: definition.runner,
			storageAdapter,
			pluginManager: pluginManager as any,
			serverOptions: {},
			corsHeaders: { 'X-Test': 'true' },
			abortController: new AbortController()
		});

		const text = await response.text();

		expect(text).toContain('"stream_start"');
		expect(text).toContain('data: processed-raw');
		expect(text).toContain('"stream_end"');
		expect(storageAdapter.openRun).toHaveBeenCalled();
		expect(appendCalls).toEqual(['processed-raw']);

		expect(pluginManager.notifyStreamInfo).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: 'run-1',
				streamId: 'storage-stream',
				isResumable: true
			}),
			'demo'
		);

		expect(pluginManager.notifyStreamFinished).toHaveBeenCalledWith(
			'success',
			expect.objectContaining({
				status: 'success',
				totalChunks: 1
			}),
			'demo'
		);

		expect(complete).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'success',
				totalChunks: 1
			})
		);

		expect(afterRun).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'success',
				runId: 'run-1'
			})
		);
	});

	it('fails the stream when chunk validation fails', async () => {
		const complete = vi.fn();
		const fail = vi.fn();
		const writer: StreamRunWriter<string> = {
			append: vi.fn(async () => {}),
			complete: async (summary) => complete(summary),
			fail: async (summary) => fail(summary),
			abort: vi.fn(async () => {}),
			streamId: null
		};

		const storageAdapter = createStorageAdapter(writer);

		const pluginManager = {
			notifyStreamInfo: vi.fn(),
			processChunk: vi.fn((chunk: string) => chunk),
			notifyStreamFinished: vi.fn(),
			notifyHeartbeat: vi.fn()
		};

		const definition: StreamDefinition<string, string, {}> = {
			name: 'demo',
			chunkSchema: failureSchema,
			runner: async ({ appendChunk }) => {
				appendChunk('bad');
			},
			use: []
		};

		const response = createStreamResponse({
			streamName: 'demo',
			definition,
			runId: 'run-2',
			parsedInput: 'input',
			baseMeta: createBaseMeta(),
			extendedContext: {},
			runner: definition.runner,
			storageAdapter,
			pluginManager: pluginManager as any,
			serverOptions: {},
			corsHeaders: {},
			abortController: new AbortController()
		});

		const text = await response.text();
		expect(text).toContain('"stream_start"');

		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(pluginManager.notifyStreamFinished).toHaveBeenCalledWith(
			'canceled',
			expect.objectContaining({
				status: 'canceled'
			}),
			'demo'
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(complete).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'canceled',
				totalChunks: 0
			})
		);
		expect(fail).not.toHaveBeenCalled();
	});

	it('replays stored chunks and skips ones acknowledged by Last-Event-ID', async () => {
		const storedChunks = ['cached-1', 'cached-2', 'cached-3'];
		const append = vi.fn(async () => {});
		const complete = vi.fn(async () => {});
		const writer: StreamRunWriter<string> = {
			append,
			complete,
			fail: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			streamId: 'run-123'
		};

		const adapter = createStorageAdapter(writer);
		const storedRun = {
			runId: 'run-123',
			streamName: 'demo',
			startedAt: new Date(),
			finishedAt: null,
			status: 'in-progress' as const,
			totalChunks: storedChunks.length,
			durationMs: null,
			chunks: [...storedChunks]
		};

		if (adapter.loadRun) {
			adapter.loadRun = vi.fn(async () => storedRun);
		}

		const pluginManager = {
			notifyStreamInfo: vi.fn(),
			processChunk: vi.fn((chunk: string) => chunk.toUpperCase()),
			notifyStreamFinished: vi.fn(),
			notifyHeartbeat: vi.fn()
		};

		const runner = vi.fn(async ({ appendChunk }) => {
			appendChunk('fresh-1');
			appendChunk('fresh-2');
		});

		const resumeInfo = adapter.loadRun ? await adapter.loadRun('run-123') : storedRun;
		const response = createStreamResponse({
			streamName: 'demo',
			definition: {
				name: 'demo',
				chunkSchema: stringSchema,
				runner,
				use: []
			},
			runId: 'run-123',
			parsedInput: null,
			baseMeta: createBaseMeta(),
			extendedContext: {},
			runner,
			storageAdapter: adapter,
			pluginManager: pluginManager as any,
			serverOptions: {},
			corsHeaders: {},
			abortController: new AbortController(),
			resume: {
				storedRun: resumeInfo,
				lastEventId: 'run-123:2'
			}
		});

		const raw = await response.text();

		expect(raw).toContain('id: run-123:0');
		expect(raw).not.toContain('cached-1');
		expect(raw).not.toContain('cached-2');
		expect(raw).toContain('cached-3');
		expect(raw).toContain('FRESH-1');
		expect(raw).toContain('FRESH-2');
		expect(raw).toContain('id: run-123:6');

		expect(runner).toHaveBeenCalledTimes(1);
		expect(adapter.openRun).toHaveBeenCalled();
	});
});
