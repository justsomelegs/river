import type { BaseStreamContext, RiverPluginReturn, RiverPluginScope } from '../../types.js';

type Hook<K extends keyof RiverPluginReturn> = NonNullable<RiverPluginReturn[K]>;

export type ContextBuilderMap = Record<string, (meta: BaseStreamContext) => unknown>;

export type InferContextFromBuilders<T extends ContextBuilderMap> = {
	[K in keyof T]: T[K] extends (meta: BaseStreamContext) => infer R ? R : never;
};

export interface CreateRiverPluginInput<
	Context,
	Scope extends RiverPluginScope = RiverPluginScope,
	Id extends string = string
> {
	id: Id;
	scope: Scope;
	init?: Hook<'onInit'>;
	wrap?: Hook<'wrapRunner'>;
	onRequest?: Hook<'onRequest'>;
	onChunk?: Hook<'onChunk'>;
	onComplete?: Hook<'onComplete'>;
	onStreamEnd?: Hook<'onStreamEnd'>;
	onStreamInfo?: Hook<'onStreamInfo'>;
	onHeartbeat?: Hook<'onHeartbeat'>;
	transformChunk?: Hook<'transformChunk'>;
	extend?: (meta: BaseStreamContext) => Context;
}

export type CreateRiverPluginInputWithoutContext<
	Scope extends RiverPluginScope = RiverPluginScope,
	Id extends string = string
> = Omit<CreateRiverPluginInput<Record<string, never>, Scope, Id>, 'extend'> & {
	extend?: undefined;
};
