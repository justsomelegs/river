import { describe, expect, it } from 'vitest';

import {
	createInMemoryStorageAdapter,
	getStoredStream,
	getStoredStreamCount,
	clearStoredStreams
} from '../in-memory.js';
import { createDefaultStorageAdapter } from '../default.js';
import type { StreamRunWriter } from '../../types.js';

const openRun = async <Chunk>(
	adapter: ReturnType<typeof createInMemoryStorageAdapter<Chunk>>,
	runId: string
): Promise<StreamRunWriter<Chunk>> => {
	const writer = await adapter.openRun({
		runId,
		streamName: 'test',
		startedAt: new Date(),
		definition: {
			name: 'test',
			chunkSchema: {
				'~standard': {
					version: 1,
					vendor: 'test',
					validate: (value: unknown) =>
						({
							value
						}) as any
				}
			},
			runner: async () => {},
			use: []
		} as any,
		attributes: {}
	});

	return writer;
};

describe('in-memory storage adapter', () => {
	it('isolates state per adapter instance', async () => {
		const adapterOne = createInMemoryStorageAdapter<{ index: number }>();
		const adapterTwo = createInMemoryStorageAdapter<{ index: number }>();

		const writerOne = await openRun(adapterOne, 'run-1');
		await writerOne.append({ index: 0 }, { index: 0, emittedAt: new Date() });
		await writerOne.complete({
			status: 'success',
			totalChunks: 1,
			durationMs: 10,
			finishedAt: new Date()
		});

		const writerTwo = await openRun(adapterTwo, 'run-2');
		await writerTwo.append({ index: 42 }, { index: 0, emittedAt: new Date() });
		await writerTwo.complete({
			status: 'success',
			totalChunks: 1,
			durationMs: 5,
			finishedAt: new Date()
		});

		const storedOne = getStoredStream(adapterOne, 'run-1');
		const storedTwo = getStoredStream(adapterTwo, 'run-1');

		expect(storedOne?.chunks).toHaveLength(1);
		expect(storedTwo).toBeNull();

		expect(getStoredStreamCount(adapterOne)).toBe(1);
		expect(getStoredStreamCount(adapterTwo)).toBe(1);

		clearStoredStreams(adapterOne);
		expect(getStoredStreamCount(adapterOne)).toBe(0);
		expect(getStoredStreamCount(adapterTwo)).toBe(1);
	});
});

describe('default storage adapter', () => {
	it('performs no-op persistence', async () => {
		const adapter = createDefaultStorageAdapter();
		const writer = await adapter.openRun({
			runId: 'noop',
			streamName: 'noop',
			startedAt: new Date(),
			definition: {
				name: 'noop',
				chunkSchema: {
					'~standard': {
						version: 1,
						vendor: 'test',
						validate: (value: unknown) =>
							({
								value
							}) as any
					}
				},
				runner: async () => {},
				use: []
			} as any,
			attributes: {}
		});
		await writer.append({} as any, { index: 0, emittedAt: new Date() });
		await writer.complete({
			status: 'success',
			totalChunks: 0,
			durationMs: 0,
			finishedAt: new Date()
		});
		expect(writer.streamId).toBeNull();
	});
});
