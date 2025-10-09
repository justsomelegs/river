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

export interface BaseStreamContext {
	event: RequestEvent;
}

export type StreamRunnerArgs<Input, Chunk> = {
	input: Input;
	appendChunk: (chunk: Chunk) => void;
	meta: BaseStreamContext;
	abortSignal: AbortSignal;
	runId: string;
};

export type StreamRunner<Input, Chunk, Context = {}> = (
	args: StreamRunnerArgs<Input, Chunk> & Context
) => Promise<void> | void;

export type BeforeRunArgs<Input, Context = {}> = {
	input: Input;
	meta: BaseStreamContext;
	runId: string;
	abortSignal: AbortSignal;
} & Context;

export type AfterRunArgs<Context = {}> = {
	status: 'success' | 'error' | 'canceled';
	runId: string;
	meta: BaseStreamContext;
} & Context;

export type StreamDefinition<Input = unknown, Chunk = unknown, Context = {}> = {
	chunkSchema: StandardSchemaV1<unknown, Chunk>;
	inputSchema?: StandardSchemaV1<unknown, Input>;
	runner: StreamRunner<Input, Chunk, Context>;
	beforeRun?: (args: BeforeRunArgs<Input, Context>) => Promise<Input> | Input;
	afterRun?: (args: AfterRunArgs<Context>) => Promise<void> | void;
};

export type StreamBuilderFn<PluginContext = {}> = <
	C extends StandardSchemaV1,
	I extends StandardSchemaV1 | undefined = undefined
>(
	config: I extends StandardSchemaV1
		? {
				chunkSchema: C;
				inputSchema: I;
				runner: StreamRunner<
					StandardSchemaV1.InferOutput<I>,
					StandardSchemaV1.InferOutput<C>,
					PluginContext
				>;
				beforeRun?: (
					args: BeforeRunArgs<StandardSchemaV1.InferOutput<I>, PluginContext>
				) => Promise<StandardSchemaV1.InferOutput<I>> | StandardSchemaV1.InferOutput<I>;
				afterRun?: (args: AfterRunArgs<PluginContext>) => Promise<void> | void;
			}
		: {
				chunkSchema: C;
				runner: StreamRunner<unknown, StandardSchemaV1.InferOutput<C>, PluginContext>;
				beforeRun?: (args: BeforeRunArgs<unknown, PluginContext>) => Promise<unknown> | unknown;
				afterRun?: (args: AfterRunArgs<PluginContext>) => Promise<void> | void;
			}
) => StreamDefinition<any, any, PluginContext>;

export interface RiverPluginReturn<Context = {}> {
	id: string;
	onInit?: () => void | Promise<void>;
	wrapRunner?: <I, C, Ctx>(next: StreamRunner<I, C, Ctx>) => StreamRunner<I, C, Ctx>;
	onRequest?: (event: RequestEvent) => void | Promise<void>;
	onChunk?: (chunk: unknown, streamName: string) => unknown;
	onComplete?: (status: 'success' | 'error', streamName: string) => void | Promise<void>;
	extendRunnerContext?: (meta: BaseStreamContext) => Context;
}

export interface PluginContext {
	getStream: (name: string) => StreamDefinition<any, any, any> | undefined;
}

export type RiverPlugin<Context = {}> = (ctx: PluginContext) => RiverPluginReturn<Context>;

export type RiverServerConfig = {
	heartbeatInterval?: number;
	cors?: {
		origin?: string | string[] | ((origin: string) => boolean);
		credentials?: boolean;
	};
};

export type MergeContexts<T extends readonly any[]> = T extends readonly [
	infer First,
	...infer Rest
]
	? First & MergeContexts<Rest>
	: {};

export type InferPluginContext<T> = T extends RiverPlugin<infer Context> ? Context : {};

export type InferPluginsContext<T extends readonly RiverPlugin<any>[]> = MergeContexts<{
	[K in keyof T]: InferPluginContext<T[K]>;
}>;
