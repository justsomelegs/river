export { riverServer, riverConfig } from './server.js';
export { createSSEStream as createSseStream } from './sse.js';
export { ai } from './plugins/ai.js';
export { createRiverPlugin } from './plugins/internal/create-river-plugin.js';
export { defineContext } from './plugins/internal/plugin-context.js';
export { createRiverClient } from './client.js';
export { createDefaultStorageProvider } from './storage.js';
export {
	createInMemoryStorageProvider,
	getStoredStream,
	getAllStoredStreams,
	clearStoredStreams,
	getStoredStreamCount
} from './in-memory-storage.js';

export type {
	AIPluginConfig,
	AIHelpers,
	StreamTextOptions,
	ToolEvent,
	NormalizedStreamPart
} from './plugins/ai.js';

export type {
	StreamDefinition,
	StreamDefinitionConfig,
	StreamRunner,
	StreamRunnerArgs,
	RiverPlugin,
	RiverPluginReturn,
	RiverPluginScope,
	RiverServerConfig,
	PluginContext,
	BaseStreamContext,
	BeforeRunArgs,
	AfterRunArgs,
	StandardSchemaV1,
	PluginDescriptor,
	PluginDescriptorConfig,
	InferPluginContext,
	InferPluginsContext,
	InferGlobalPluginsContext,
	InferStreamPluginsContext,
	FilterPluginsByScope,
	StreamPluginIds,
	MergeContexts,
	StreamInfo,
	StreamRunStatus,
	StreamLifecycleEvent,
	StreamLifecycleStartEvent,
	StreamLifecycleEndEvent,
	RIVER_STREAM_EVENT_KEY,
	StreamDefinitionMap,
	StreamInputType,
	StreamChunkType,
	StreamCompletionSummary,
	StreamStorageProvider,
	StreamStorageSession
} from './types.js';

export type {
	RiverClient,
	RiverStreamCaller,
	RiverStreamStatus,
	StreamCallerOptions
} from './client.js';
