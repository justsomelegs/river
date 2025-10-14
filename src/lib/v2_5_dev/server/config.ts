import type {
	AfterRunArgs,
	BeforeRunArgs,
	PluginConfigsFromDescriptors,
	PluginDescriptor,
	StreamDefinitionConfig,
	StreamStorageAdapter,
	StreamRunner,
	ValidUseArray,
	StandardSchemaV1,
	SafePluginContext,
	InferGlobalPluginsContextFromDescriptors,
	InferStreamPluginsContextFromDescriptors,
	StreamPluginIdsFromDescriptors,
	RiverServerConfig as RiverServerOptions
} from '../types.js';

type ResolvedStreamContext<
	GlobalCtx,
	StreamCtx,
	ValidIds extends string,
	Use extends ValidUseArray<ValidIds>
> = GlobalCtx & SafePluginContext<StreamCtx, Use, ValidIds>;

type StreamConfigInput<
	GlobalCtx,
	StreamCtx,
	ValidIds extends string,
	C extends StandardSchemaV1,
	I extends StandardSchemaV1 | undefined,
	Use extends ValidUseArray<ValidIds>
> = I extends StandardSchemaV1
	? {
			use?: Use;
			chunkSchema: C;
			inputSchema: I;
			runner: StreamRunner<
				StandardSchemaV1.InferOutput<I>,
				StandardSchemaV1.InferOutput<C>,
				ResolvedStreamContext<GlobalCtx, StreamCtx, ValidIds, Use>
			>;
			beforeRun?: (
				args: BeforeRunArgs<
					StandardSchemaV1.InferOutput<I>,
					ResolvedStreamContext<GlobalCtx, StreamCtx, ValidIds, Use>
				>
			) => Promise<StandardSchemaV1.InferOutput<I>> | StandardSchemaV1.InferOutput<I>;
			afterRun?: (
				args: AfterRunArgs<ResolvedStreamContext<GlobalCtx, StreamCtx, ValidIds, Use>>
			) => Promise<void> | void;
			storage?: StreamStorageAdapter<StandardSchemaV1.InferOutput<C>>;
			throttleMs?: number;
		}
	: {
			use?: Use;
			chunkSchema: C;
			runner: StreamRunner<
				unknown,
				StandardSchemaV1.InferOutput<C>,
				ResolvedStreamContext<GlobalCtx, StreamCtx, ValidIds, Use>
			>;
			beforeRun?: (
				args: BeforeRunArgs<unknown, ResolvedStreamContext<GlobalCtx, StreamCtx, ValidIds, Use>>
			) => Promise<unknown> | unknown;
			afterRun?: (
				args: AfterRunArgs<ResolvedStreamContext<GlobalCtx, StreamCtx, ValidIds, Use>>
			) => Promise<void> | void;
			storage?: StreamStorageAdapter<StandardSchemaV1.InferOutput<C>>;
			throttleMs?: number;
		};

type StreamDefiner<GlobalCtx, StreamCtx, ValidIds extends string> = <
	C extends StandardSchemaV1,
	I extends StandardSchemaV1 | undefined = undefined,
	const Use extends ValidUseArray<ValidIds> = []
>(
	config: StreamConfigInput<GlobalCtx, StreamCtx, ValidIds, C, I, Use>
) => StreamDefinitionConfig<C, I, ResolvedStreamContext<GlobalCtx, StreamCtx, ValidIds, Use>, Use>;

export function riverConfig<const P extends readonly PluginDescriptor<any, any, any, any>[]>(
	config: {
		plugins: P;
		options?: RiverServerOptions;
	} & PluginConfigsFromDescriptors<P>
) {
	type GlobalCtx = InferGlobalPluginsContextFromDescriptors<P>;
	type AllStreamCtx = InferStreamPluginsContextFromDescriptors<P>;
	type StreamIds = StreamPluginIdsFromDescriptors<P>;

	const stream: StreamDefiner<GlobalCtx, AllStreamCtx, StreamIds> = (streamConfig) => {
		return streamConfig;
	};

	return {
		stream,
		_config: config,
		_types: {} as { GlobalCtx: GlobalCtx; StreamCtx: AllStreamCtx; StreamIds: StreamIds }
	};
}
