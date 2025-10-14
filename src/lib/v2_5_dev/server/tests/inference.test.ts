import { describe, expectTypeOf, it } from 'vitest';

import { riverConfig, riverServer } from '../index.js';
import type { InferStreamMap } from '../index.js';
import { createRiverPlugin } from '../../plugins/internal/create-river-plugin.js';
import type { StandardSchemaV1 } from '../../core/standard-schema.js';

const stringSchema: StandardSchemaV1<string, string> = {
	'~standard': {
		version: 1,
		vendor: 'test',
		validate: (value: unknown) =>
			({
				value: String(value)
			}) as StandardSchemaV1.SuccessResult<string>
	}
};

const streamPlugin = {
	id: 'mock',
	scope: 'stream' as const,
	createPlugin: () =>
		createRiverPlugin<{ mock: { value: number } }, 'stream', 'mock'>({
			id: 'mock',
			scope: 'stream',
			extend: () => ({ mock: { value: 123 } })
		})
};

describe('type inference', () => {
	it('propagates plugin context through stream definitions', () => {
		const config = riverConfig({
			plugins: [streamPlugin],
			mock: {}
		});

		const stream = config.stream({
			use: ['mock'],
			chunkSchema: stringSchema,
			inputSchema: stringSchema,
			runner: async () => {}
		});

		type RunnerArgs = Parameters<typeof stream.runner>[0];
		expectTypeOf<RunnerArgs['mock']['value']>().toEqualTypeOf<number>();

		const server = riverServer(config, { sample: stream });
		type ServerRunnerArgs = Parameters<(typeof server.streams)['sample']['runner']>[0];
		expectTypeOf<ServerRunnerArgs['mock']['value']>().toEqualTypeOf<number>();

		type StreamMap = InferStreamMap<typeof server>;
		expectTypeOf<StreamMap>().toEqualTypeOf<typeof server.streams>();
	});
});
