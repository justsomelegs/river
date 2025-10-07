import type { RequestEvent } from '@sveltejs/kit';

export interface StandardSchemaV1<Input = unknown, Output = Input> {
	readonly '~standard': {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (
			value: unknown
		) => StandardSchemaV1.Result<Output> | Promise<StandardSchemaV1.Result<Output>>;
		readonly types?: StandardSchemaV1.Types<Input, Output> | undefined;
	};
}

export namespace StandardSchemaV1 {
	export type Result<Output> = SuccessResult<Output> | FailureResult;

	export interface SuccessResult<Output> {
		readonly value: Output;
		readonly issues?: undefined;
	}

	export interface FailureResult {
		readonly issues: ReadonlyArray<Issue>;
	}

	export interface Issue {
		readonly message: string;
		readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
	}

	export interface PathSegment {
		readonly key: PropertyKey;
	}

	export interface Types<Input = unknown, Output = Input> {
		readonly input: Input;
		readonly output: Output;
	}

	export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
		Schema['~standard']['types']
	>['input'];

	export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
		Schema['~standard']['types']
	>['output'];
}

export type StreamRunner<Input, Chunk> = (args: {
	input: Input;
	appendChunk: (chunk: Chunk) => void;
	meta: { event: RequestEvent };
	abortSignal: AbortSignal;
}) => Promise<void> | void;

export type StreamDefinition<Input = unknown, Chunk = unknown> = {
	chunkSchema: StandardSchemaV1<unknown, Chunk>;
	inputSchema?: StandardSchemaV1<unknown, Input>;
	runner: StreamRunner<Input, Chunk>;
};

export type RiverPlugin = (ctx: {
	getStream: (name: string) => StreamDefinition | undefined;
	addMiddleware: (mw: RiverMiddleware) => void;
}) => {
	name: string;
	onInit?: () => void | Promise<void>;
	wrapRunner?: <I, C>(next: StreamRunner<I, C>) => StreamRunner<I, C>;
	onRequest?: (event: RequestEvent) => void | Promise<void>;
	onChunk?: (chunk: unknown, streamName: string) => unknown;
	onComplete?: (status: 'success' | 'error', streamName: string) => void | Promise<void>;
};

export type RiverMiddleware = (args: {
	event: RequestEvent;
	streamName: string;
	input: unknown;
}) => Promise<{ continue: true; input?: unknown } | { continue: false; response: Response }>;

export type RiverServerConfig = {
	heartbeatInterval?: number;
	cors?: {
		origin?: string | string[] | ((origin: string) => boolean);
		credentials?: boolean;
	};
};
