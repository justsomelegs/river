import type {
	BaseStreamContext,
	RiverPlugin,
	RiverPluginReturn,
	RiverPluginScope
} from '../../types.js';

type Hook<K extends keyof RiverPluginReturn> = NonNullable<RiverPluginReturn[K]>;

export interface CreateRiverPluginInput<
	Context,
	Scope extends RiverPluginScope = RiverPluginScope
> {
	id: string;
	scope: Scope;
	init?: Hook<'onInit'>;
	wrap?: Hook<'wrapRunner'>;
	onRequest?: Hook<'onRequest'>;
	onChunk?: Hook<'onChunk'>;
	onComplete?: Hook<'onComplete'>;
	extend?: (meta: BaseStreamContext) => Context;
}

type WithoutContext<Scope extends RiverPluginScope = RiverPluginScope> = Omit<
	CreateRiverPluginInput<Record<string, never>, Scope>,
	'extend'
> & {
	extend?: undefined;
};

export function createRiverPlugin<Scope extends RiverPluginScope>(
	spec: WithoutContext<Scope>
): RiverPlugin<Record<string, never>, Scope>;
export function createRiverPlugin<Context, Scope extends RiverPluginScope = RiverPluginScope>(
	spec: CreateRiverPluginInput<Context, Scope>
): RiverPlugin<Context, Scope>;
export function createRiverPlugin<Context, Scope extends RiverPluginScope = RiverPluginScope>(
	spec: CreateRiverPluginInput<Context, Scope>
): RiverPlugin<Context, Scope> {
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
			extendRunnerContext: spec.extend
		}) as RiverPluginReturn<Context, Scope>;
}
