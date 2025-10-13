import type {
	BaseStreamContext,
	RiverPlugin,
	RiverPluginReturn,
	RiverPluginScope
} from '../../types.js';

type Hook<K extends keyof RiverPluginReturn> = NonNullable<RiverPluginReturn[K]>;

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
	extend?: (meta: BaseStreamContext) => Context;
	onStreamInfo?: Hook<'onStreamInfo'>;
	onHeartbeat?: Hook<'onHeartbeat'>;
	transformChunk?: Hook<'transformChunk'>;
}

type WithoutContext<Scope extends RiverPluginScope = RiverPluginScope, Id extends string = string> = Omit<
	CreateRiverPluginInput<Record<string, never>, Scope, Id>,
	'extend'
> & {
	extend?: undefined;
};

export function createRiverPlugin<Scope extends RiverPluginScope, Id extends string>(
	spec: WithoutContext<Scope, Id>
): RiverPlugin<Record<string, never>, Scope, Id>;
export function createRiverPlugin<Context, Scope extends RiverPluginScope = RiverPluginScope, Id extends string = string>(
	spec: CreateRiverPluginInput<Context, Scope, Id>
): RiverPlugin<Context, Scope, Id>;
export function createRiverPlugin<Context, Scope extends RiverPluginScope = RiverPluginScope, Id extends string = string>(
	spec: CreateRiverPluginInput<Context, Scope, Id>
): RiverPlugin<Context, Scope, Id> {
	if (!spec.id) {
		throw new Error('Plugin requires a stable id');
	}

	return () =>
		({
			id: spec.id,
			scope: spec.scope,
			onInit: spec.init,
			wrapRunner: spec.wrap,
			onRequest: spec.onRequest,
			onChunk: spec.onChunk,
			onComplete: spec.onComplete,
			onStreamEnd: spec.onStreamEnd,
			onStreamInfo: spec.onStreamInfo,
			onHeartbeat: spec.onHeartbeat,
			transformChunk: spec.transformChunk,
			extendRunnerContext: spec.extend
		}) as RiverPluginReturn<Context, Scope, Id>;
}
