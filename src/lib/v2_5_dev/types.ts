import type { RequestEvent } from '@sveltejs/kit';

type Simplify<T> = { [K in keyof T]: T[K] } & {};

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
	use?: readonly string[];
	chunkSchema: StandardSchemaV1<unknown, Chunk>;
	inputSchema?: StandardSchemaV1<unknown, Input>;
	runner: StreamRunner<Input, Chunk, Context>;
	beforeRun?: (args: BeforeRunArgs<Input, Context>) => Promise<Input> | Input;
	afterRun?: (args: AfterRunArgs<Context>) => Promise<void> | void;
};

export type StreamBuilderFn<GlobalContext = {}, StreamContext = {}> = <
	C extends StandardSchemaV1,
	I extends StandardSchemaV1 | undefined = undefined,
	Use extends readonly (keyof StreamContext)[] = []
>(
	config: I extends StandardSchemaV1
		? {
				use?: Use;
				chunkSchema: C;
				inputSchema: I;
				runner: StreamRunner<
					StandardSchemaV1.InferOutput<I>,
					StandardSchemaV1.InferOutput<C>,
					GlobalContext & Pick<StreamContext, Use[number]>
				>;
				beforeRun?: (
					args: BeforeRunArgs<
						StandardSchemaV1.InferOutput<I>,
						GlobalContext & Pick<StreamContext, Use[number]>
					>
				) => Promise<StandardSchemaV1.InferOutput<I>> | StandardSchemaV1.InferOutput<I>;
				afterRun?: (
					args: AfterRunArgs<GlobalContext & Pick<StreamContext, Use[number]>>
				) => Promise<void> | void;
			}
		: {
				use?: Use;
				chunkSchema: C;
				runner: StreamRunner<
					unknown,
					StandardSchemaV1.InferOutput<C>,
					GlobalContext & Pick<StreamContext, Use[number]>
				>;
				beforeRun?: (
					args: BeforeRunArgs<unknown, GlobalContext & Pick<StreamContext, Use[number]>>
				) => Promise<unknown> | unknown;
				afterRun?: (
					args: AfterRunArgs<GlobalContext & Pick<StreamContext, Use[number]>>
				) => Promise<void> | void;
			}
) => StreamDefinition<any, any, GlobalContext & Pick<StreamContext, Use[number]>>;

export type RiverPluginScope = 'global' | 'stream';

export interface RiverPluginReturn<
	Context = {},
	Scope extends RiverPluginScope = RiverPluginScope
> {
	id: string;
	scope: Scope;
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

export type RiverPlugin<Context = {}, Scope extends RiverPluginScope = RiverPluginScope> = (
	ctx: PluginContext
) => RiverPluginReturn<Context, Scope>;

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

export type InferPluginContext<T> = T extends RiverPlugin<infer Context, any> ? Context : {};

export type InferPluginsContext<T extends readonly RiverPlugin<any, any>[]> = MergeContexts<{
	[K in keyof T]: InferPluginContext<T[K]>;
}>;

// Filter plugins by scope
export type FilterPluginsByScope<
	T extends readonly RiverPlugin<any, any>[],
	Scope extends RiverPluginScope
> = {
	[K in keyof T]: T[K] extends RiverPlugin<any, any>
		? ReturnType<T[K]> extends { scope: Scope }
			? T[K]
			: never
		: never;
}[number][];

// Infer global plugins context
export type InferGlobalPluginsContext<T extends readonly RiverPlugin<any, any>[]> = MergeContexts<{
	[K in keyof T]: ReturnType<T[K]> extends { scope: 'global' } ? InferPluginContext<T[K]> : {};
}>;

// Infer stream plugins context
export type InferStreamPluginsContext<T extends readonly RiverPlugin<any, any>[]> = MergeContexts<{
	[K in keyof T]: ReturnType<T[K]> extends { scope: 'stream' } ? InferPluginContext<T[K]> : {};
}>;

// Get stream plugin IDs for autocomplete
export type StreamPluginIds<T extends readonly RiverPlugin<any, any>[]> = {
	[K in keyof T]: ReturnType<T[K]> extends { scope: 'stream'; id: infer Id } ? Id : never;
}[number];
