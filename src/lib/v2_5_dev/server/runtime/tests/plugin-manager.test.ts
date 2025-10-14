import { describe, expect, it, vi } from 'vitest';

import { createPluginManager } from '../plugin-manager.js';
import type { PluginDescriptor, RiverPluginReturn } from '../../../types.js';

const createDescriptors = () => {
	const calls: string[] = [];

	const globalHooks = {
		onInit: vi.fn(),
		onRequest: vi.fn(),
		onStreamInfo: vi.fn(),
		onChunk: vi.fn(),
		transformChunk: vi.fn((chunk: unknown) => chunk),
		onComplete: vi.fn(),
		onStreamEnd: vi.fn(),
		onHeartbeat: vi.fn(),
		wrapRunner: vi.fn(),
		extendRunnerContext: vi.fn(() => ({ globalCtx: 'g' }))
	};

	const streamHooks = {
		onInit: vi.fn(),
		onRequest: vi.fn(),
		onStreamInfo: vi.fn(),
		onChunk: vi.fn(),
		transformChunk: vi.fn((chunk: unknown) => chunk),
		onComplete: vi.fn(),
		onStreamEnd: vi.fn(),
		onHeartbeat: vi.fn(),
		wrapRunner: vi.fn(),
		extendRunnerContext: vi.fn(() => ({ streamCtx: 's' }))
	};

	const globalDescriptor: PluginDescriptor<
		{ label: string },
		{ globalCtx: string },
		'global',
		'global'
	> = {
		id: 'global',
		scope: 'global',
		createPlugin: (config) => () => {
			const plugin: RiverPluginReturn<{ globalCtx: string }, 'global', 'global'> = {
				id: 'global',
				scope: 'global',
				onInit: globalHooks.onInit,
				onRequest: globalHooks.onRequest,
				onStreamInfo: globalHooks.onStreamInfo,
				onChunk: (chunk) => {
					globalHooks.onChunk(chunk);
					return chunk;
				},
				onComplete: globalHooks.onComplete,
				onStreamEnd: globalHooks.onStreamEnd,
				onHeartbeat: () => {
					globalHooks.onHeartbeat();
				},
				transformChunk: (chunk) => {
					globalHooks.transformChunk(chunk);
					return chunk;
				},
				wrapRunner: (next) => {
					globalHooks.wrapRunner();
					return async (args) => {
						calls.push('global-before');
						await next(args);
						calls.push('global-after');
					};
				},
				extendRunnerContext: () => {
					globalHooks.extendRunnerContext();
					return { globalCtx: config.label };
				}
			};

			return plugin;
		}
	};

	const streamDescriptor: PluginDescriptor<void, { streamCtx: string }, 'stream', 'stream'> = {
		id: 'stream',
		scope: 'stream',
		createPlugin: () => () => {
			const plugin: RiverPluginReturn<{ streamCtx: string }, 'stream', 'stream'> = {
				id: 'stream',
				scope: 'stream',
				onInit: streamHooks.onInit,
				onRequest: streamHooks.onRequest,
				onStreamInfo: streamHooks.onStreamInfo,
				onChunk: (chunk) => {
					streamHooks.onChunk(chunk);
					return chunk;
				},
				onComplete: streamHooks.onComplete,
				onStreamEnd: streamHooks.onStreamEnd,
				onHeartbeat: () => {
					streamHooks.onHeartbeat();
				},
				transformChunk: (chunk) => {
					streamHooks.transformChunk(chunk);
					return typeof chunk === 'string' ? `${chunk}-stream` : chunk;
				},
				wrapRunner: (next) => {
					streamHooks.wrapRunner();
					return async (args) => {
						calls.push('stream-before');
						await next(args);
						calls.push('stream-after');
					};
				},
				extendRunnerContext: () => {
					streamHooks.extendRunnerContext();
					return { streamCtx: 's' };
				}
			};

			return plugin;
		}
	};

	return { calls, globalDescriptor, streamDescriptor, globalHooks, streamHooks };
};

describe('plugin manager', () => {
	it('applies wrappers and contexts in correct order', async () => {
		const { calls, globalDescriptor, streamDescriptor, globalHooks, streamHooks } =
			createDescriptors();

		const pluginContext = { getStream: vi.fn() };
		const manager = createPluginManager(
			[globalDescriptor, streamDescriptor],
			{
				plugins: [globalDescriptor, streamDescriptor],
				global: { label: 'configured' },
				stream: {}
			},
			pluginContext
		);

		expect(globalHooks.onInit).toHaveBeenCalled();
		expect(streamHooks.onInit).toHaveBeenCalled();

		const runner = vi.fn(async () => {
			calls.push('runner');
		});

		const wrapped = manager.applyRunnerWrappers(runner, ['stream']);
		await wrapped({} as any);

		expect(calls).toEqual([
			'stream-before',
			'global-before',
			'runner',
			'global-after',
			'stream-after'
		]);
		expect(globalHooks.wrapRunner).toHaveBeenCalled();
		expect(streamHooks.wrapRunner).toHaveBeenCalled();

		const context = manager.buildExtendedContext({} as any, ['stream']);
		expect(context).toEqual({ globalCtx: 'configured', streamCtx: 's' });
		expect(globalHooks.extendRunnerContext).toHaveBeenCalled();
		expect(streamHooks.extendRunnerContext).toHaveBeenCalled();
	});

	it('forwards lifecycle notifications and chunk transforms', async () => {
		const { globalDescriptor, streamDescriptor, globalHooks, streamHooks } = createDescriptors();

		const manager = createPluginManager(
			[globalDescriptor, streamDescriptor],
			{
				plugins: [globalDescriptor, streamDescriptor],
				global: { label: 'configured' },
				stream: {}
			},
			{ getStream: vi.fn() }
		);

		const event = { request: new Request('https://example.com') } as any;
		await manager.notifyRequest(event);
		expect(globalHooks.onRequest).toHaveBeenCalledWith(event);
		expect(streamHooks.onRequest).toHaveBeenCalledWith(event);

		await manager.notifyStreamInfo({ runId: 'id', streamId: null, isResumable: false }, 'demo');
		expect(globalHooks.onStreamInfo).toHaveBeenCalled();
		expect(streamHooks.onStreamInfo).toHaveBeenCalled();

		const processed = manager.processChunk('chunk', 'demo');
		expect(processed).toBe('chunk-stream');
		expect(globalHooks.transformChunk).toHaveBeenCalled();
		expect(streamHooks.transformChunk).toHaveBeenCalled();
		expect(streamHooks.onChunk).toHaveBeenCalled();

		await manager.notifyStreamFinished(
			'success',
			{
				__river_stream_event__: 'stream_end',
				runId: 'id',
				streamId: null,
				status: 'success',
				totalChunks: 1,
				durationMs: 10
			},
			'demo'
		);

		expect(globalHooks.onComplete).toHaveBeenCalledWith('success', 'demo');
		expect(streamHooks.onStreamEnd).toHaveBeenCalled();

		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		streamHooks.onHeartbeat.mockImplementation(() => {
			throw new Error('boom');
		});

		await manager.notifyHeartbeat('demo');
		expect(streamHooks.onHeartbeat).toHaveBeenCalled();
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});
});
