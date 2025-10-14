import { createStorageAdapter } from './adapter.js';
import type { StreamRunWriter, StreamStorageAdapter } from '../types.js';

export interface DefaultStorageAdapterOptions {
	id?: string;
}

export function createDefaultStorageAdapter<Chunk>(
	options?: DefaultStorageAdapterOptions
): StreamStorageAdapter<Chunk> {
	const id = options?.id ?? 'default';

	return createStorageAdapter({
		id,
		capabilities: {
			resumable: false,
			listable: false,
			purgeable: false
		},
		async openRun(): Promise<StreamRunWriter<Chunk>> {
			return {
				streamId: null,
				async append() {
					// no-op storage
				},
				async complete() {
					// no-op storage
				},
				async fail() {
					// no-op storage
				}
			};
		}
	});
}
