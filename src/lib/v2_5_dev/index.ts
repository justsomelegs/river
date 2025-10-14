export { riverServer, riverConfig } from './server.js';
export type { RiverServerInstance, RiverEndpoint, InferStreamMap } from './server.js';
export { ai } from './plugins/ai/index.js';
export { createRiverPlugin } from './plugins/internal/create-river-plugin.js';
export { defineContext } from './plugins/internal/plugin-context.js';
export { createRiverClient, RiverClientError } from './client.js';
export { createDefaultStorageAdapter } from './storage/default.js';
export { createStorageAdapter } from './storage/adapter.js';
export {
	createInMemoryStorageAdapter,
	getStoredStream,
	getAllStoredStreams,
	clearStoredStreams,
	getStoredStreamCount
} from './storage/in-memory.js';

export type {
	AIPluginConfig,
	AIHelpers,
	StreamTextOptions,
	ToolEvent,
	NormalizedStreamPart,
	AIPluginDescriptor
} from './plugins/ai/types.js';

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
	StreamStorageAdapter,
	StreamRunWriter,
	StorageCapabilities,
	StorageRunContext,
	StorageRunQuery,
	StoredRun,
	StoredRunSummary,
	StorageHealthReport,
	ChunkMeta,
	CompletionSummary,
	FailureSummary,
	AbortSummary
} from './types.js';

export type {
	RiverClient,
	RiverStreamCaller,
	RiverStreamStatus,
	RiverClientConfig,
	RiverClientRetryConfig,
	RiverClientLogger,
	RiverFetch,
	StreamCallerOptions,
	RiverStreamEvent,
	StreamStartOptions,
	RiverHttpErrorDetails
} from './client.js';

export type { DefaultStorageAdapterOptions } from './storage/default.js';
export type { InMemoryStorageOptions } from './storage/in-memory.js';
export type { StorageAdapterConfig } from './storage/adapter.js';
