import type { RiverPlugin, RiverPluginReturn, RiverPluginScope } from '../../types.js';
import type { CreateRiverPluginInput, CreateRiverPluginInputWithoutContext } from './types.js';

export function createRiverPlugin<Scope extends RiverPluginScope, Id extends string>(
	spec: CreateRiverPluginInputWithoutContext<Scope, Id>
): RiverPlugin<Record<string, never>, Scope, Id>;
export function createRiverPlugin<
	Context,
	Scope extends RiverPluginScope = RiverPluginScope,
	Id extends string = string
>(spec: CreateRiverPluginInput<Context, Scope, Id>): RiverPlugin<Context, Scope, Id>;
export function createRiverPlugin<
	Context,
	Scope extends RiverPluginScope = RiverPluginScope,
	Id extends string = string
>(spec: CreateRiverPluginInput<Context, Scope, Id>): RiverPlugin<Context, Scope, Id> {
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
