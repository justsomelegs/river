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
	name: string;
	use?: readonly string[];
	chunkSchema: StandardSchemaV1<unknown, Chunk>;
	inputSchema?: StandardSchemaV1<unknown, Input>;
	runner: StreamRunner<Input, Chunk, Context>;
	beforeRun?: (args: BeforeRunArgs<Input, Context>) => Promise<Input> | Input;
	afterRun?: (args: AfterRunArgs<Context>) => Promise<void> | void;
};

export type StreamBuilderFn<GlobalContext = {}, StreamContext = {}, ValidKeys = keyof StreamContext> = <
	C extends StandardSchemaV1,
	I extends StandardSchemaV1 | undefined = undefined,
	const Use extends readonly (keyof StreamContext)[] = []
>(
	config: I extends StandardSchemaV1
		? {
			use?: Use;
			chunkSchema: C;
			inputSchema: I;
			runner: StreamRunner<
				StandardSchemaV1.InferOutput<I>,
				StandardSchemaV1.InferOutput<C>,
				GlobalContext & SafePluginContext<StreamContext, Use, ValidKeys>
			>;
			beforeRun?: (
				args: BeforeRunArgs<
					StandardSchemaV1.InferOutput<I>,
					GlobalContext & SafePluginContext<StreamContext, Use, ValidKeys>
				>
			) => Promise<StandardSchemaV1.InferOutput<I>> | StandardSchemaV1.InferOutput<I>;
			afterRun?: (
				args: AfterRunArgs<GlobalContext & SafePluginContext<StreamContext, Use, ValidKeys>>
			) => Promise<void> | void;
		}
		: {
			use?: Use;
			chunkSchema: C;
			runner: StreamRunner<
				unknown,
				StandardSchemaV1.InferOutput<C>,
				GlobalContext & SafePluginContext<StreamContext, Use, ValidKeys>
			>;
			beforeRun?: (
				args: BeforeRunArgs<unknown, GlobalContext & SafePluginContext<StreamContext, Use, ValidKeys>>
			) => Promise<unknown> | unknown;
			afterRun?: (
				args: AfterRunArgs<GlobalContext & SafePluginContext<StreamContext, Use, ValidKeys>>
			) => Promise<void> | void;
		}
) => StreamDefinition<any, any, GlobalContext & SafePluginContext<StreamContext, Use, ValidKeys>>;

export type RiverPluginScope = 'global' | 'stream';

export interface RiverPluginReturn<
	Context = {},
	Scope extends RiverPluginScope = RiverPluginScope,
	Id extends string = string
> {
	id: Id;
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

export interface PluginDescriptor<Config = any, Context = {}, Scope extends RiverPluginScope = RiverPluginScope, Id extends string = string> {
	id: Id;
	scope: Scope;
	createPlugin: (config: Config) => RiverPlugin<Context, Scope, Id>;
}

export type PluginDescriptorConfig<T> = T extends PluginDescriptor<infer Config, any, any, any> ? Config : never;

export type RiverPlugin<Context = {}, Scope extends RiverPluginScope = RiverPluginScope, Id extends string = string> = (
	ctx: PluginContext
) => RiverPluginReturn<Context, Scope, Id>;

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

export type InferPluginContext<T> = T extends RiverPlugin<infer Context, any, any> ? Context : {};

export type InferPluginsContext<T extends readonly RiverPlugin<any, any, any>[]> = MergeContexts<{
	[K in keyof T]: InferPluginContext<T[K]>;
}>;

// Filter plugins by scope
export type FilterPluginsByScope<
	T extends readonly RiverPlugin<any, any, any>[],
	Scope extends RiverPluginScope
> = {
	[K in keyof T]: T[K] extends RiverPlugin<any, any, any>
	? ReturnType<T[K]> extends { scope: Scope }
	? T[K]
	: never
	: never;
}[number][];

// Infer global plugins context
export type InferGlobalPluginsContext<T extends readonly RiverPlugin<any, any, any>[]> = MergeContexts<{
	[K in keyof T]: ReturnType<T[K]> extends { scope: 'global' } ? InferPluginContext<T[K]> : {};
}>;

// Infer stream plugins context
export type InferStreamPluginsContext<T extends readonly RiverPlugin<any, any, any>[]> = MergeContexts<{
	[K in keyof T]: ReturnType<T[K]> extends { scope: 'stream' } ? InferPluginContext<T[K]> : {};
}>;

// Get stream plugin IDs for autocomplete
export type StreamPluginIds<T extends readonly RiverPlugin<any, any, any>[]> = {
	[K in keyof T]: ReturnType<T[K]> extends { scope: 'stream'; id: infer Id } ? Id : never;
}[number];

// Plugin descriptor helper types
// Helper to extract plugin ID
type ExtractPluginId<T> = T extends PluginDescriptor<any, any, any, infer Id> ? Id : never;

// Helper to extract config for a specific ID
type ExtractConfigForId<P extends readonly PluginDescriptor<any, any, any, any>[], Id extends string> =
	Extract<P[number], { id: Id }> extends PluginDescriptor<infer Config, any, any, any> ? Config : never;

// Map plugin descriptors to their config objects by ID
export type PluginConfigsFromDescriptors<P extends readonly PluginDescriptor<any, any, any, any>[]> = {
	[Id in ExtractPluginId<P[number]>]: ExtractConfigForId<P, Id>
};

export type ResolvePlugins<P extends readonly PluginDescriptor<any, any, any, any>[]> = {
	readonly [K in keyof P]: ReturnType<P[K]['createPlugin']>;
};

// Server config type that combines base config with plugin configs
export type RiverServerConfigWithPlugins<
	P extends readonly PluginDescriptor<any, any, any, any>[],
	T extends Record<string, any>
> = {
		[K in keyof ({
			plugins: P;
			streams: (
				stream: StreamBuilderFn<
					InferGlobalPluginsContext<ResolvePlugins<P>>,
					InferStreamPluginsContext<ResolvePlugins<P>>
				>
			) => T;
			options?: RiverServerConfig;
		} & PluginConfigsFromDescriptors<P>)]: ({
			plugins: P;
			streams: (
				stream: StreamBuilderFn<
					InferGlobalPluginsContext<ResolvePlugins<P>>,
					InferStreamPluginsContext<ResolvePlugins<P>>
				>
			) => T;
			options?: RiverServerConfig;
		} & PluginConfigsFromDescriptors<P>)[K]
	};

// Helper to infer context from descriptor
export type InferDescriptorContext<D> = D extends PluginDescriptor<any, infer Context, any, any> ? Context : never;

// Recursive union for stream plugin IDs from descriptors
export type StreamPluginIdsFromDescriptors<
	P extends readonly PluginDescriptor<any, any, any, any>[]
> = P extends readonly [infer Head, ...infer Tail]
	? Head extends PluginDescriptor<any, any, 'stream', infer Id>
	? Id | StreamPluginIdsFromDescriptors<Tail>
	: StreamPluginIdsFromDescriptors<Tail>
	: never;

// Merge contexts for stream plugins from descriptors
export type InferStreamPluginsContextFromDescriptors<
	P extends readonly PluginDescriptor<any, any, any, any>[]
> = MergeContexts<
	{ [K in keyof P]: P[K] extends PluginDescriptor<any, infer C, 'stream', any> ? C : {} }
>;

// Merge contexts for global plugins from descriptors
export type InferGlobalPluginsContextFromDescriptors<
	P extends readonly PluginDescriptor<any, any, any, any>[]
> = MergeContexts<
	{ [K in keyof P]: P[K] extends PluginDescriptor<any, infer C, 'global', any> ? C : {} }
>;

// Strict Pick that only includes keys that exist in both T and the union K
// This ensures that invalid keys result in an empty object type
export type StrictPick<T, K> = Pick<T, Extract<K, keyof T>>;

// Helper to validate that all items in the Use array are valid keys
// Returns an error type with invalid keys listed
type FindInvalidKeys<Use extends readonly any[], ValidKeys> =
	Use extends readonly []
	? never
	: Use extends readonly [infer First, ...infer Rest]
	? First extends ValidKeys
	? Rest extends readonly any[]
	? FindInvalidKeys<Rest, ValidKeys>
	: never
	: First | (Rest extends readonly any[] ? FindInvalidKeys<Rest, ValidKeys> : never)
	: never;

// Constrain the Use array to only contain valid plugin IDs
export type ValidUseArray<ValidIds> = readonly ValidIds[];

export type SafePluginContext<StreamCtx, Use extends readonly any[], ValidIds> =
	FindInvalidKeys<Use, ValidIds> extends never
	? StrictPick<StreamCtx, Use[number]>
	: {};