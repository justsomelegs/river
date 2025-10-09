import type { BaseStreamContext, RiverPlugin, RiverPluginReturn } from '../../types.js';

type Hook<K extends keyof RiverPluginReturn> = NonNullable<RiverPluginReturn[K]>;

export interface CreateRiverPluginInput<Context> {
	id: string;
	init?: Hook<'onInit'>;
	wrap?: Hook<'wrapRunner'>;
	onRequest?: Hook<'onRequest'>;
	onChunk?: Hook<'onChunk'>;
	onComplete?: Hook<'onComplete'>;
	extend?: (meta: BaseStreamContext) => Context;
}

type WithoutContext = Omit<CreateRiverPluginInput<Record<string, never>>, 'extend'> & {
	extend?: undefined;
};

export function createRiverPlugin(spec: WithoutContext): RiverPlugin;
export function createRiverPlugin<Context>(
	spec: CreateRiverPluginInput<Context>
): RiverPlugin<Context>;
export function createRiverPlugin<Context>(
	spec: CreateRiverPluginInput<Context>
): RiverPlugin<Context> {
	if (!spec.id) {
		throw new Error('Plugin requires a stable id');
	}

	return () => ({
		id: spec.id,
		onInit: spec.init,
		wrapRunner: spec.wrap,
		onRequest: spec.onRequest,
		onChunk: spec.onChunk,
		onComplete: spec.onComplete,
		extendRunnerContext: spec.extend
	});
}
