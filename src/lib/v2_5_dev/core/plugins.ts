import type { RequestEvent } from '@sveltejs/kit';
import type {
	BaseStreamContext,
	StreamLifecycleEndEvent,
	StreamInfo,
	StreamRunStatus
} from './lifecycle.js';
import type { StreamDefinition, StreamRunner } from './stream.js';

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
	onComplete?: (status: StreamRunStatus, streamName: string) => void | Promise<void>;
	onStreamEnd?: (event: StreamLifecycleEndEvent, streamName: string) => void | Promise<void>;
	onStreamInfo?: (info: StreamInfo, streamName: string) => void | Promise<void>;
	onHeartbeat?: (streamName: string) => void | Promise<void>;
	transformChunk?: (chunk: unknown, streamName: string) => unknown;
	extendRunnerContext?: (meta: BaseStreamContext) => Context;
}

export interface PluginContext {
	getStream: (name: string) => StreamDefinition<any, any, any> | undefined;
}

export type RiverPlugin<
	Context = {},
	Scope extends RiverPluginScope = RiverPluginScope,
	Id extends string = string
> = (ctx: PluginContext) => RiverPluginReturn<Context, Scope, Id>;

export interface PluginDescriptor<
	Config = any,
	Context = {},
	Scope extends RiverPluginScope = RiverPluginScope,
	Id extends string = string
> {
	id: Id;
	scope: Scope;
	createPlugin: (config: Config) => RiverPlugin<Context, Scope, Id>;
	defaultConfig?: () => Config;
}

export type PluginDescriptorConfig<T> =
	T extends PluginDescriptor<infer Config, any, any, any> ? Config : never;

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

export type InferGlobalPluginsContext<T extends readonly RiverPlugin<any, any, any>[]> =
	MergeContexts<{
		[K in keyof T]: ReturnType<T[K]> extends { scope: 'global' } ? InferPluginContext<T[K]> : {};
	}>;

export type InferStreamPluginsContext<T extends readonly RiverPlugin<any, any, any>[]> =
	MergeContexts<{
		[K in keyof T]: ReturnType<T[K]> extends { scope: 'stream' } ? InferPluginContext<T[K]> : {};
	}>;

export type StreamPluginIds<T extends readonly RiverPlugin<any, any, any>[]> = {
	[K in keyof T]: ReturnType<T[K]> extends { scope: 'stream'; id: infer Id } ? Id : never;
}[number];

type ExtractPluginId<T> = T extends PluginDescriptor<any, any, any, infer Id> ? Id : never;

type ExtractConfigForId<
	P extends readonly PluginDescriptor<any, any, any, any>[],
	Id extends string
> =
	Extract<P[number], { id: Id }> extends PluginDescriptor<infer Config, any, any, any>
		? Config
		: never;

type PluginIds<P extends readonly PluginDescriptor<any, any, any, any>[]> = ExtractPluginId<
	P[number]
>;

type OptionalConfigIds<P extends readonly PluginDescriptor<any, any, any, any>[]> = {
	[Id in PluginIds<P>]: undefined extends ExtractConfigForId<P, Id> ? Id : never;
}[PluginIds<P>];

type RequiredConfigIds<P extends readonly PluginDescriptor<any, any, any, any>[]> = Exclude<
	PluginIds<P>,
	OptionalConfigIds<P>
>;

export type PluginConfigsFromDescriptors<
	P extends readonly PluginDescriptor<any, any, any, any>[]
> = { [Id in RequiredConfigIds<P>]: ExtractConfigForId<P, Id> } & {
	[Id in OptionalConfigIds<P>]?: Exclude<ExtractConfigForId<P, Id>, undefined>;
} extends infer Result
	? { [K in keyof Result]: Result[K] }
	: never;

export type ResolvePlugins<P extends readonly PluginDescriptor<any, any, any, any>[]> = {
	readonly [K in keyof P]: ReturnType<P[K]['createPlugin']>;
};

export type StreamPluginIdsFromDescriptors<
	P extends readonly PluginDescriptor<any, any, any, any>[]
> = P extends readonly [
	infer Head,
	...infer Tail extends readonly PluginDescriptor<any, any, any, any>[]
]
	? Head extends PluginDescriptor<any, any, 'stream', infer Id>
		? Id | StreamPluginIdsFromDescriptors<Tail>
		: StreamPluginIdsFromDescriptors<Tail>
	: never;

export type InferStreamPluginsContextFromDescriptors<
	P extends readonly PluginDescriptor<any, any, any, any>[]
> = MergeContexts<{
	[K in keyof P]: P[K] extends PluginDescriptor<any, infer C, 'stream', any> ? C : {};
}>;

export type InferGlobalPluginsContextFromDescriptors<
	P extends readonly PluginDescriptor<any, any, any, any>[]
> = MergeContexts<{
	[K in keyof P]: P[K] extends PluginDescriptor<any, infer C, 'global', any> ? C : {};
}>;

export type StrictPick<T, K> = Pick<T, Extract<K, keyof T>>;

type FindInvalidKeys<Use extends readonly any[], ValidKeys> = Use extends readonly []
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
	FindInvalidKeys<Use, ValidIds> extends never ? StrictPick<StreamCtx, Use[number]> : {};
