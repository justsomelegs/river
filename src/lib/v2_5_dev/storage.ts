import type {
    StreamStorageProvider,
    StreamStorageSession,
    StreamRunStatus
} from './types.js';

export interface DefaultStorageProviderOptions {
    id?: string;
}

class DefaultStorageSession<Chunk> implements StreamStorageSession<Chunk> {
    private readonly runId: string;

    constructor(runId: string) {
        this.runId = runId;
    }

    append(_chunk: Chunk) {
    }

    close(_summary: { status: StreamRunStatus; totalChunks: number; durationMs: number }) {
    }

    getStreamInfo() {
        return {
            runId: this.runId,
            streamId: null,
            isResumable: false
        };
    }
}

export function createDefaultStorageProvider<Chunk>(
    options?: DefaultStorageProviderOptions
): StreamStorageProvider<Chunk> {
    const id = options?.id ?? 'default';

    return {
        id,
        isResumable: false,
        async createStorageSession({ runId }) {
            return new DefaultStorageSession<Chunk>(runId);
        }
    };
}
