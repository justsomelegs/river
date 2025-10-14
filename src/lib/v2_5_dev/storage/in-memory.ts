import { createStorageAdapter } from './adapter.js';
import type {
	AbortSummary,
	CompletionSummary,
	FailureSummary,
	StorageRunQuery,
	StorageRunContext,
	StoredRun,
	StoredRunSummary,
	StreamRunWriter,
	StreamStorageAdapter
} from '../types.js';

type StoredRunRecord<Chunk> = StoredRun<Chunk> & {
	createdAt: Date;
};

const cloneRun = <Chunk>(run: StoredRunRecord<Chunk>): StoredRun<Chunk> => ({
	runId: run.runId,
	streamName: run.streamName,
	startedAt: run.startedAt,
	finishedAt: run.finishedAt,
	status: run.status,
	totalChunks: run.totalChunks,
	durationMs: run.durationMs,
	chunks: [...run.chunks]
});

const summarizeRun = (run: StoredRunRecord<any>): StoredRunSummary => ({
	runId: run.runId,
	streamName: run.streamName,
	startedAt: run.startedAt,
	finishedAt: run.finishedAt,
	status: run.status,
	totalChunks: run.totalChunks,
	durationMs: run.durationMs
});

const ensureCapacity = <Chunk>(
	store: Map<string, StoredRunRecord<Chunk>>,
	maxStoredStreams: number
) => {
	if (maxStoredStreams <= 0) return;
	while (store.size > maxStoredStreams) {
		let oldestEntry: StoredRunRecord<Chunk> | undefined;
		for (const record of store.values()) {
			if (!oldestEntry || record.createdAt.getTime() < oldestEntry.createdAt.getTime()) {
				oldestEntry = record;
			}
		}
		if (!oldestEntry) break;
		store.delete(oldestEntry.runId);
	}
};

const adapterStores = new WeakMap<StreamStorageAdapter<any>, Map<string, StoredRunRecord<any>>>();

export interface InMemoryStorageOptions {
	id?: string;
	maxStoredStreams?: number;
}

export function createInMemoryStorageAdapter<Chunk>(
	options?: InMemoryStorageOptions
): StreamStorageAdapter<Chunk> {
	const id = options?.id ?? 'in-memory';
	const maxStoredStreams = options?.maxStoredStreams ?? 100;
	const store = new Map<string, StoredRunRecord<Chunk>>();

	const adapter = createStorageAdapter({
		id,
		capabilities: {
			resumable: true,
			listable: true,
			purgeable: true,
			abortable: true
		},
		async openRun(context: StorageRunContext<Chunk>) {
			let record = store.get(context.runId);

			if (!record) {
				record = {
					runId: context.runId,
					streamName: context.streamName,
					startedAt: context.startedAt,
					finishedAt: null,
					status: 'in-progress',
					totalChunks: 0,
					durationMs: null,
					chunks: [],
					createdAt: context.startedAt
				};
				store.set(context.runId, record);
				ensureCapacity(store, maxStoredStreams);
			} else {
				record.status = 'in-progress';
				record.finishedAt = null;
				record.durationMs = null;
			}

			const writer: StreamRunWriter<Chunk> & Required<Pick<StreamRunWriter<Chunk>, 'abort'>> = {
				streamId: context.runId,
				async append(chunk, _meta) {
					record!.chunks.push(chunk);
					record!.totalChunks = record!.chunks.length;
				},
				async flush() {
					// in-memory writer has nothing to flush
				},
				async complete(summary: CompletionSummary) {
					record!.status = summary.status;
					record!.totalChunks = summary.totalChunks;
					record!.durationMs = summary.durationMs;
					record!.finishedAt = summary.finishedAt;
				},
				async fail(summary: FailureSummary) {
					record!.status = summary.status;
					record!.totalChunks = summary.totalChunks;
					record!.durationMs = summary.durationMs;
					record!.finishedAt = summary.finishedAt;
				},
				async abort(summary: AbortSummary) {
					record!.status = summary.status;
					record!.totalChunks = summary.totalChunks;
					record!.durationMs = summary.durationMs;
					record!.finishedAt = summary.finishedAt;
				}
			};

			return writer;
		},
		async loadRun(runId) {
			const run = store.get(runId);
			return run ? cloneRun(run) : null;
		},
		async listRuns(query?: StorageRunQuery) {
			let runs = [...store.values()];

			if (query?.streamName) {
				runs = runs.filter((run) => run.streamName === query.streamName);
			}

			if (query?.status && query.status.length > 0) {
				const statusSet = new Set(query.status);
				runs = runs.filter((run) => statusSet.has(run.status));
			}

			runs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

			if (query?.limit && query.limit > 0) {
				runs = runs.slice(0, query.limit);
			}

			return runs.map(summarizeRun);
		},
		async purgeRun(runId) {
			store.delete(runId);
		}
	});

	adapterStores.set(adapter, store as Map<string, StoredRunRecord<any>>);
	return adapter;
}

function requireStore<Chunk>(
	adapter: StreamStorageAdapter<Chunk>
): Map<string, StoredRunRecord<Chunk>> {
	const store = adapterStores.get(adapter as StreamStorageAdapter<any>);
	if (!store) {
		throw new Error('Adapter was not created by createInMemoryStorageAdapter');
	}
	return store as Map<string, StoredRunRecord<Chunk>>;
}

export function getStoredStream<Chunk>(
	adapter: StreamStorageAdapter<Chunk>,
	runId: string
): StoredRun<Chunk> | null {
	const store = requireStore(adapter);
	const run = store.get(runId);
	return run ? cloneRun(run) : null;
}

export function getAllStoredStreams<Chunk>(
	adapter: StreamStorageAdapter<Chunk>
): StoredRunSummary[] {
	const store = requireStore(adapter);
	return [...store.values()].map(summarizeRun);
}

export function clearStoredStreams<Chunk>(adapter: StreamStorageAdapter<Chunk>) {
	const store = requireStore(adapter);
	store.clear();
}

export function getStoredStreamCount<Chunk>(adapter: StreamStorageAdapter<Chunk>) {
	return requireStore(adapter).size;
}
