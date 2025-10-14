import type {
	StorageCapabilities,
	StorageHealthReport,
	StorageRunContext,
	StorageRunQuery,
	StreamRunWriter,
	StreamStorageAdapter,
	StoredRun,
	StoredRunSummary
} from '../types.js';

type AbortableWriter<Chunk> = StreamRunWriter<Chunk> &
	Required<Pick<StreamRunWriter<Chunk>, 'abort'>>;

export type StorageAdapterConfig<Chunk, Caps extends StorageCapabilities> = {
	id: string;
	capabilities: Caps;
	openRun: Caps['abortable'] extends true
		? (context: StorageRunContext<Chunk>) => Promise<AbortableWriter<Chunk>>
		: (context: StorageRunContext<Chunk>) => Promise<StreamRunWriter<Chunk>>;
	health?: () => Promise<StorageHealthReport>;
	shutdown?: () => Promise<void>;
} & (Caps['resumable'] extends true
	? { loadRun: (runId: string) => Promise<StoredRun<Chunk> | null> }
	: { loadRun?: never }) &
	(Caps['listable'] extends true
		? { listRuns: (query?: StorageRunQuery) => Promise<StoredRunSummary[]> }
		: { listRuns?: never }) &
	(Caps['purgeable'] extends true
		? { purgeRun: (runId: string) => Promise<void> }
		: { purgeRun?: never });

export function createStorageAdapter<Chunk, Caps extends StorageCapabilities>(
	config: StorageAdapterConfig<Chunk, Caps>
): StreamStorageAdapter<Chunk> {
	const { id, capabilities, openRun, health, shutdown } = config;
	const adapter: StreamStorageAdapter<Chunk> = {
		id,
		capabilities,
		openRun: openRun as (context: StorageRunContext<Chunk>) => Promise<StreamRunWriter<Chunk>>
	};

	if (capabilities.resumable) {
		adapter.loadRun = (
			config as StorageAdapterConfig<Chunk, Caps> & {
				loadRun: (runId: string) => Promise<StoredRun<Chunk> | null>;
			}
		).loadRun;
	}

	if (capabilities.listable) {
		adapter.listRuns = (
			config as StorageAdapterConfig<Chunk, Caps> & {
				listRuns: (query?: StorageRunQuery) => Promise<StoredRunSummary[]>;
			}
		).listRuns;
	}

	if (capabilities.purgeable) {
		adapter.purgeRun = (
			config as StorageAdapterConfig<Chunk, Caps> & {
				purgeRun: (runId: string) => Promise<void>;
			}
		).purgeRun;
	}

	if (health) {
		adapter.health = health;
	}

	if (shutdown) {
		adapter.shutdown = shutdown;
	}

	return adapter;
}
