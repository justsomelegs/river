export { createStorageAdapter } from './adapter.js';
export type { StorageAdapterConfig } from './adapter.js';

export { createDefaultStorageAdapter } from './default.js';
export type { DefaultStorageAdapterOptions } from './default.js';

export {
	createInMemoryStorageAdapter,
	getStoredStream,
	getAllStoredStreams,
	clearStoredStreams,
	getStoredStreamCount
} from './in-memory.js';
export type { InMemoryStorageOptions } from './in-memory.js';
