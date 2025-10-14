import type { RequestEvent } from '@sveltejs/kit';

export interface BaseStreamContext {
	event: RequestEvent;
}

export const RIVER_STREAM_EVENT_KEY = '__river_stream_event__' as const;

export type StreamRunStatus = 'success' | 'error' | 'canceled';

export type StreamLifecycleStartEvent = {
	[RIVER_STREAM_EVENT_KEY]: 'stream_start';
	runId: string;
	streamId: string | null;
	isResumable: boolean;
};

export type StreamLifecycleEndEvent = {
	[RIVER_STREAM_EVENT_KEY]: 'stream_end';
	runId: string;
	streamId: string | null;
	status: StreamRunStatus;
	totalChunks: number;
	durationMs: number;
};

export type StreamLifecycleEvent = StreamLifecycleStartEvent | StreamLifecycleEndEvent;

export type StreamInfo = {
	runId: string;
	streamId: string | null;
	isResumable: boolean;
};
