import type { RequestEvent } from '@sveltejs/kit';
import {
	type StreamDefinition,
	type StreamDefinitionConfig,
	type RiverServerConfig as RiverServerOptions,
	type PluginDescriptor,
	type StreamRunner,
	type BaseStreamContext,
	type StreamStorageAdapter,
	type StandardSchemaV1,
	type StreamDefinitionMap,
	type StoredRun
} from '../types.js';
import { createDefaultStorageAdapter } from '../storage/default.js';
import { buildCorsHeaders } from './runtime/cors.js';
import { createPluginManager } from './runtime/plugin-manager.js';
import type { PluginManager } from './runtime/plugin-manager.js';
import { createStreamResponse } from './runtime/stream-executor.js';

type ConfigToDefinition<T> =
	T extends StreamDefinitionConfig<infer C, infer I, infer Context, any>
		? StreamDefinition<
				I extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<I> : unknown,
				StandardSchemaV1.InferOutput<C>,
				Context
			>
		: T extends StreamDefinition<any, any, any>
			? T
			: never;

type ConvertStreamConfigs<T> = {
	[K in keyof T]: ConfigToDefinition<T[K]>;
};

export interface RiverEndpoint {
	POST(event: RequestEvent): Promise<Response>;
	OPTIONS(event: RequestEvent): Promise<Response>;
}

export interface RiverServerInstance<Streams extends StreamDefinitionMap> {
	readonly streams: Streams;
	toEndpoint: () => RiverEndpoint;
}

export type InferStreamMap<T extends RiverServerInstance<any>> = T['streams'];

interface RuntimeConfig {
	_config: any;
	_types: any;
	stream: any;
}

export function riverServer<
	const S extends Record<string, StreamDefinitionConfig<any, any, any, any>>
>(config: RuntimeConfig, streams: S): RiverServerInstance<ConvertStreamConfigs<S>> {
	const actualConfig = config._config;
	const serverOptions: RiverServerOptions = actualConfig.options || {};
	const pluginDescriptors = actualConfig.plugins as readonly PluginDescriptor<any, any, any, any>[];

	validatePluginConfig(actualConfig);

	const streamPluginIds = new Set(
		pluginDescriptors
			.filter((descriptor) => descriptor.scope === 'stream')
			.map((descriptor) => descriptor.id)
	);

	const registry: Record<string, StreamDefinition<any, any, any>> = {};
	const pluginContext = {
		getStream: (name: string) => registry[name]
	};

	const pluginManager = createPluginManager(pluginDescriptors, actualConfig, pluginContext);

	const defaultStorageAdapter = createDefaultStorageAdapter<any>();

	for (const [name, definition] of Object.entries(streams)) {
		const normalized = normalizeStreamDefinition(name, definition, streamPluginIds);
		registry[name] = normalized;
	}

	const typedStreams = registry as unknown as ConvertStreamConfigs<S>;

	const handle: RiverServerInstance<ConvertStreamConfigs<S>> = {
		get streams() {
			return typedStreams;
		},
		toEndpoint: () =>
			buildEndpoint({
				streams: registry,
				serverOptions,
				pluginManager,
				defaultStorageAdapter
			})
	};

	return handle;
}

function validatePluginConfig(actualConfig: any) {
	const descriptors = actualConfig.plugins as readonly PluginDescriptor<any, any, any, any>[];
	const pluginIds = new Set(descriptors.map((p) => p.id));
	const configKeys = Object.keys(actualConfig).filter(
		(key) => key !== 'plugins' && key !== 'options'
	);

	for (const key of configKeys) {
		if (!pluginIds.has(key)) {
			throw new Error(`Invalid config key "${key}". Must match a plugin ID from plugins array.`);
		}
	}
}

function normalizeStreamDefinition(
	name: string,
	definition: StreamDefinitionConfig<any, any, any, any>,
	validStreamPluginIds: Set<string>
): StreamDefinition<any, any, any> {
	const normalized: StreamDefinition<any, any, any> = {
		name,
		use: definition.use ?? [],
		chunkSchema: definition.chunkSchema,
		runner: definition.runner as any,
		beforeRun: definition.beforeRun as any,
		afterRun: definition.afterRun as any,
		storage: definition.storage,
		throttleMs: definition.throttleMs
	};

	if ('inputSchema' in definition && definition.inputSchema) {
		normalized.inputSchema = definition.inputSchema as any;
	}

	if (normalized.use && normalized.use.length > 0) {
		const invalidPlugins = normalized.use.filter((pluginId) => !validStreamPluginIds.has(pluginId));
		if (invalidPlugins.length > 0) {
			throw new Error(
				`Stream "${name}" references unknown plugin ids: ${invalidPlugins.join(', ')}`
			);
		}
	}

	return normalized;
}

interface EndpointDependencies {
	streams: Record<string, StreamDefinition<any, any, any>>;
	serverOptions: RiverServerOptions;
	pluginManager: PluginManager;
	defaultStorageAdapter: StreamStorageAdapter<any>;
}

function buildEndpoint({
	streams,
	serverOptions,
	pluginManager,
	defaultStorageAdapter
}: EndpointDependencies): RiverEndpoint {
	return {
		async OPTIONS(event: RequestEvent) {
			const corsHeaders = buildCorsHeaders(serverOptions, event.request.headers.get('origin'));
			return new Response(null, {
				status: 204,
				headers: {
					...corsHeaders,
					'Access-Control-Allow-Methods': 'POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type, Authorization',
					'Access-Control-Max-Age': '86400'
				}
			});
		},
		async POST(event: RequestEvent) {
			const corsHeaders = buildCorsHeaders(serverOptions, event.request.headers.get('origin'));

			await pluginManager.notifyRequest(event);

			let body: Record<string, unknown>;
			try {
				body = await event.request.json();
			} catch {
				return jsonError('Invalid JSON', 400, corsHeaders);
			}

			const name = typeof body.name === 'string' ? body.name : undefined;
			if (!name) {
				return jsonError('Missing stream name', 400, corsHeaders);
			}

			const definition = streams[name];
			if (!definition) {
				return jsonError(`Unknown stream "${name}"`, 404, corsHeaders);
			}

			let parsedInput = body.input;
			if (definition.inputSchema) {
				const validation = definition.inputSchema['~standard'].validate(parsedInput);
				const result = validation instanceof Promise ? await validation : validation;
				if (result.issues) {
					return jsonError(result.issues, 400, corsHeaders);
				}
				parsedInput = result.value;
			}

			const abortController = new AbortController();
			const runner = pluginManager.applyRunnerWrappers(definition.runner, definition.use);

			const baseMeta: BaseStreamContext = { event };
			const extendedContext = pluginManager.buildExtendedContext(baseMeta, definition.use);

			const runId =
				typeof body.runId === 'string' && body.runId.length > 0 ? body.runId : crypto.randomUUID();

			let effectiveInput = parsedInput;
			if (definition.beforeRun) {
				try {
					effectiveInput = await definition.beforeRun({
						input: parsedInput,
						meta: baseMeta,
						runId,
						abortSignal: abortController.signal,
						...extendedContext
					});
				} catch (error) {
					return jsonError(
						{
							error: 'beforeRun hook failed',
							details: error instanceof Error ? error.message : 'Unknown error'
						},
						500,
						corsHeaders
					);
				}
			}

			const storageAdapter = (definition.storage ??
				defaultStorageAdapter) as StreamStorageAdapter<any>;
			let resumeStoredRun: StoredRun<any> | null = null;

			if (storageAdapter.capabilities.resumable && typeof storageAdapter.loadRun === 'function') {
				if (runId) {
					try {
						resumeStoredRun = await storageAdapter.loadRun(runId);
					} catch (error) {
						console.error(`Failed to load stored run "${runId}" for stream "${name}":`, error);
					}
				}
			}

			const resumeLastEventId = event.request.headers.get('last-event-id');

			const response = createStreamResponse({
				streamName: name,
				definition,
				runId,
				parsedInput: effectiveInput,
				baseMeta,
				extendedContext,
				runner: runner as StreamRunner<any, any, any>,
				storageAdapter,
				pluginManager,
				serverOptions,
				corsHeaders,
				abortController,
				resume: {
					storedRun: resumeStoredRun,
					lastEventId: resumeLastEventId
				}
			});

			return response;
		}
	};
}

function jsonError(message: unknown, status: number, headers: Record<string, string> = {}) {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: {
			'Content-Type': 'application/json',
			...headers
		}
	});
}
