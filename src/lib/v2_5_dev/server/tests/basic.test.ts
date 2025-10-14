import { describe, expect, it, vi } from 'vitest';

import { riverConfig, riverServer } from '../index.js';
import { createRiverPlugin } from '../../plugins/internal/create-river-plugin.js';
import type { PluginDescriptor } from '../../types.js';
import type { StandardSchemaV1 } from '../../core/standard-schema.js';

const passThroughSchema = <T>(): StandardSchemaV1<T, T> => ({
	'~standard': {
		version: 1,
		vendor: 'test',
		validate: (value: unknown) =>
			({
				value
			}) as StandardSchemaV1.SuccessResult<T>
	}
});

describe('riverServer basic setup', () => {
	it('registers streams and uses plugin default configs', async () => {
		const defaultConfig = { enabled: true };
		const createPluginSpy = vi.fn();

		const descriptor: PluginDescriptor<
			typeof defaultConfig | undefined,
			Record<string, never>,
			'stream',
			'mock'
		> = {
			id: 'mock',
			scope: 'stream',
			defaultConfig: () => defaultConfig,
			createPlugin(config) {
				createPluginSpy(config);
				return createRiverPlugin({
					id: 'mock',
					scope: 'stream'
				});
			}
		};

		const config = riverConfig({
			plugins: [descriptor]
		});

		const stream = config.stream({
			chunkSchema: passThroughSchema<string>(),
			runner: async ({ appendChunk }) => {
				appendChunk('hello');
			}
		});

		const server = riverServer(config, {
			testStream: stream
		});

		expect(server.streams.testStream).toBeDefined();
		expect(createPluginSpy).toHaveBeenCalledWith(defaultConfig);

		const endpoint = server.toEndpoint();
		expect(typeof endpoint.POST).toBe('function');
		expect(typeof endpoint.OPTIONS).toBe('function');
	});
});
