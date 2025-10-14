import type { StreamDefinition } from './stream.js';
import type { StreamRunStatus } from './lifecycle.js';

export interface StorageCapabilities {
	resumable: boolean;
	listable: boolean;
	purgeable: boolean;
	abortable?: boolean;
}

export interface StreamStorageAdapter<Chunk> {
	readonly id: string;
	readonly capabilities: StorageCapabilities;
	openRun: (context: StorageRunContext<Chunk>) => Promise<StreamRunWriter<Chunk>>;
	loadRun?: (runId: string) => Promise<StoredRun<Chunk> | null>;
	listRuns?: (query?: StorageRunQuery) => Promise<StoredRunSummary[]>;
	purgeRun?: (runId: string) => Promise<void>;
	health?: () => Promise<StorageHealthReport>;
	shutdown?: () => Promise<void>;
}

export interface StreamRunWriter<Chunk> {
	append: (chunk: Chunk, meta: ChunkMeta) => Promise<void>;
	flush?: () => Promise<void>;
	complete: (summary: CompletionSummary) => Promise<void>;
	fail: (summary: FailureSummary) => Promise<void>;
	abort?: (summary: AbortSummary) => Promise<void>;
	streamId?: string | null;
}

export interface StorageRunContext<Chunk> {
	runId: string;
	streamName: string;
	definition: StreamDefinition<any, Chunk, any>;
	startedAt: Date;
	attributes: Record<string, unknown>;
}

export interface ChunkMeta {
	index: number;
	emittedAt: Date;
	ingressLatencyMs?: number;
	approxSizeBytes?: number;
}

export interface CompletionBase {
	totalChunks: number;
	durationMs: number;
	finishedAt: Date;
}

export interface CompletionSummary extends CompletionBase {
	status: 'success' | 'canceled';
}

export interface FailureSummary extends CompletionBase {
	status: 'error';
	error: unknown;
}

export interface AbortSummary extends CompletionBase {
	status: 'canceled';
	reason: 'client_disconnect' | 'timeout' | 'canceled' | 'shutdown';
}

export interface StoredRun<Chunk> {
	runId: string;
	streamName: string;
	startedAt: Date;
	finishedAt: Date | null;
	status: StreamRunStatus | 'in-progress';
	totalChunks: number;
	durationMs: number | null;
	chunks: Chunk[];
}

export type StoredRunSummary = Omit<StoredRun<unknown>, 'chunks'>;

export interface StorageRunQuery {
	streamName?: string;
	status?: StoredRunSummary['status'][];
	limit?: number;
	cursor?: string;
}

export interface StorageHealthReport {
	status: 'ok' | 'degraded' | 'down';
	details?: Record<string, unknown>;
}
