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
	storageProvider?: StreamStorageProvider<Chunk>;
	throttleMs?: number;
};

export type StreamDefinitionConfig<
	C extends StandardSchemaV1,
	I extends StandardSchemaV1 | undefined = undefined,
	Use extends readonly string[] = []
> = I extends StandardSchemaV1
	? {
		use?: Use;
		chunkSchema: C;
		inputSchema: I;
		runner: StreamRunner<StandardSchemaV1.InferOutput<I>, StandardSchemaV1.InferOutput<C>, any>;
		beforeRun?: (args: BeforeRunArgs<StandardSchemaV1.InferOutput<I>, any>) => Promise<StandardSchemaV1.InferOutput<I>> | StandardSchemaV1.InferOutput<I>;
		afterRun?: (args: AfterRunArgs<any>) => Promise<void> | void;
		storageProvider?: StreamStorageProvider<StandardSchemaV1.InferOutput<C>>;
		throttleMs?: number;
	}
	: {
		use?: Use;
		chunkSchema: C;
		runner: StreamRunner<unknown, StandardSchemaV1.InferOutput<C>, any>;
		beforeRun?: (args: BeforeRunArgs<unknown, any>) => Promise<unknown> | unknown;
		afterRun?: (args: AfterRunArgs<any>) => Promise<void> | void;
		storageProvider?: StreamStorageProvider<StandardSchemaV1.InferOutput<C>>;
		throttleMs?: number;
	};

export interface StreamStorageProvider<Chunk> {
	readonly id: string;
	readonly isResumable: boolean;
	createStorageSession: (args: {
		runId: string;
		streamName: string;
	}) => Promise<StreamStorageSession<Chunk>> | StreamStorageSession<Chunk>;
}

export interface StreamStorageSession<Chunk> {
	append: (chunk: Chunk) => void;
	close: (args: { status: StreamRunStatus; totalChunks: number; durationMs: number }) => void;
	getStreamInfo: () => StreamInfo;
}

export type StreamDefinitionMap = Record<string, StreamDefinition<any, any, any>>;

export type StreamInputType<T extends StreamDefinition<any, any, any>> = T extends StreamDefinition<infer Input, any, any>
	? Input
	: never;

export type StreamChunkType<T extends StreamDefinition<any, any, any>> = T extends StreamDefinition<any, infer Chunk, any>
	? Chunk
	: never;

export type StreamCompletionSummary = {
	status: StreamRunStatus;
	totalChunks: number;
	durationMs: number;
	runId: string;
	streamId: string | null;
};

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
	onStreamEnd?: (event: StreamLifecycleEndEvent, streamName: string) => void | Promise<void>;
	onStreamInfo?: (info: StreamInfo, streamName: string) => void | Promise<void>;
	onHeartbeat?: (streamName: string) => void | Promise<void>;
	transformChunk?: (chunk: unknown, streamName: string) => unknown;
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

export type InferGlobalPluginsContext<T extends readonly RiverPlugin<any, any, any>[]> = MergeContexts<{
	[K in keyof T]: ReturnType<T[K]> extends { scope: 'global' } ? InferPluginContext<T[K]> : {};
}>;

export type InferStreamPluginsContext<T extends readonly RiverPlugin<any, any, any>[]> = MergeContexts<{
	[K in keyof T]: ReturnType<T[K]> extends { scope: 'stream' } ? InferPluginContext<T[K]> : {};
}>;

export type StreamPluginIds<T extends readonly RiverPlugin<any, any, any>[]> = {
	[K in keyof T]: ReturnType<T[K]> extends { scope: 'stream'; id: infer Id } ? Id : never;
}[number];

type ExtractPluginId<T> = T extends PluginDescriptor<any, any, any, infer Id> ? Id : never;

type ExtractConfigForId<P extends readonly PluginDescriptor<any, any, any, any>[], Id extends string> =
	Extract<P[number], { id: Id }> extends PluginDescriptor<infer Config, any, any, any> ? Config : never;

export type PluginConfigsFromDescriptors<P extends readonly PluginDescriptor<any, any, any, any>[]> = {
	[Id in ExtractPluginId<P[number]>]: ExtractConfigForId<P, Id>
};

export type ResolvePlugins<P extends readonly PluginDescriptor<any, any, any, any>[]> = {
	readonly [K in keyof P]: ReturnType<P[K]['createPlugin']>;
};

export type StreamPluginIdsFromDescriptors<
	P extends readonly PluginDescriptor<any, any, any, any>[]
> = P extends readonly [infer Head, ...infer Tail extends readonly PluginDescriptor<any, any, any, any>[]]
	? Head extends PluginDescriptor<any, any, 'stream', infer Id>
	? Id | StreamPluginIdsFromDescriptors<Tail>
	: StreamPluginIdsFromDescriptors<Tail>
	: never;

export type InferStreamPluginsContextFromDescriptors<
	P extends readonly PluginDescriptor<any, any, any, any>[]
> = MergeContexts<
	{ [K in keyof P]: P[K] extends PluginDescriptor<any, infer C, 'stream', any> ? C : {} }
>;

export type InferGlobalPluginsContextFromDescriptors<
	P extends readonly PluginDescriptor<any, any, any, any>[]
> = MergeContexts<
	{ [K in keyof P]: P[K] extends PluginDescriptor<any, infer C, 'global', any> ? C : {} }
>;

export type StrictPick<T, K> = Pick<T, Extract<K, keyof T>>;

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

type ValidUseId<Ids> = [Ids] extends [never] ? string : Ids;

export type ValidUseArray<ValidIds> = readonly ValidUseId<ValidIds>[];

export type SafePluginContext<StreamCtx, Use extends readonly any[], ValidIds> =
	FindInvalidKeys<Use, ValidIds> extends never
	? StrictPick<StreamCtx, Use[number]>
	: {};