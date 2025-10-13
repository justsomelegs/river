import type {
    StreamStorageProvider,
    StreamStorageSession,
    StreamRunStatus
} from './types.js';

const memoryStore = new Map<string, {
    chunks: any[];
    status: StreamRunStatus | null;
    totalChunks: number;
    durationMs: number;
    createdAt: Date;
}>();

class InMemoryStorageSession<Chunk> implements StreamStorageSession<Chunk> {
    private readonly streamId: string;
    private readonly chunks: Chunk[] = [];

    constructor(streamId: string, existingChunks?: Chunk[]) {
        this.streamId = streamId;
        if (existingChunks) {
            this.chunks.push(...existingChunks);
        }
    }

    append(chunk: Chunk) {
        this.chunks.push(chunk);
        const existing = memoryStore.get(this.streamId);
        if (existing) {
            existing.chunks.push(chunk);
        }
    }

    close(args: { status: StreamRunStatus; totalChunks: number; durationMs: number }) {
        const existing = memoryStore.get(this.streamId);
        if (existing) {
            existing.status = args.status;
            existing.totalChunks = args.totalChunks;
            existing.durationMs = args.durationMs;
        }
    }

    getStreamInfo() {
        return {
            runId: this.streamId,
            streamId: this.streamId,
            isResumable: true
        };
    }
}

export interface InMemoryStorageOptions {
    id?: string;
    maxStoredStreams?: number;
}

export function createInMemoryStorageProvider<Chunk>(
    options?: InMemoryStorageOptions
): StreamStorageProvider<Chunk> {
    const id = options?.id ?? 'in-memory';
    const maxStoredStreams = options?.maxStoredStreams ?? 100;

    return {
        id,
        isResumable: true,
        async createStorageSession({ runId, streamName }) {
            const existingData = memoryStore.get(runId);

            if (existingData) {
                return new InMemoryStorageSession<Chunk>(runId, existingData.chunks as Chunk[]);
            }

            memoryStore.set(runId, {
                chunks: [],
                status: null,
                totalChunks: 0,
                durationMs: 0,
                createdAt: new Date()
            });

            if (memoryStore.size > maxStoredStreams) {
                const oldestKey = Array.from(memoryStore.entries())
                    .sort((a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime())[0][0];
                memoryStore.delete(oldestKey);
            }

            return new InMemoryStorageSession<Chunk>(runId);
        }
    };
}

export function getStoredStream(streamId: string) {
    const data = memoryStore.get(streamId);
    if (!data) return null;
    return {
        streamId,
        chunks: [...data.chunks],
        status: data.status,
        totalChunks: data.totalChunks,
        durationMs: data.durationMs,
        createdAt: data.createdAt
    };
}

export function getAllStoredStreams() {
    return Array.from(memoryStore.entries()).map(([id, data]) => ({
        streamId: id,
        chunkCount: data.chunks.length,
        status: data.status,
        totalChunks: data.totalChunks,
        durationMs: data.durationMs,
        createdAt: data.createdAt
    }));
}

export function clearStoredStreams() {
    memoryStore.clear();
}

export function getStoredStreamCount() {
    return memoryStore.size;
}
