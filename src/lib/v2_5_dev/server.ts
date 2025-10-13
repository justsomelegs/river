import type { RequestEvent } from '@sveltejs/kit';
import {
	RIVER_STREAM_EVENT_KEY,
	type StreamDefinition,
	type StreamRunner,
	type RiverServerConfig as RiverServerOptions,
	type RiverPluginReturn,
	type PluginContext,
	type BaseStreamContext,
	type InferGlobalPluginsContextFromDescriptors,
	type InferStreamPluginsContextFromDescriptors,
	type StreamPluginIdsFromDescriptors,
	type StandardSchemaV1,
	type PluginDescriptor,
	type PluginConfigsFromDescriptors,
	type BeforeRunArgs,
	type AfterRunArgs,
	type SafePluginContext,
	type StreamLifecycleStartEvent,
	type StreamLifecycleEndEvent,
	type StreamRunStatus,
	type StreamInfo,
	type StreamStorageProvider,
	type ValidUseArray,
	type StreamDefinitionConfig
} from './types.js';
import { createSSEStream } from './sse.js';
import { createDefaultStorageProvider } from './storage.js';

type StreamDefiner<GlobalCtx, StreamCtx, ValidIds extends string> = <
	C extends StandardSchemaV1,
	I extends StandardSchemaV1 | undefined = undefined,
	const Use extends ValidUseArray<ValidIds> = []
>(
	config: I extends StandardSchemaV1
		? {
			use?: Use;
			chunkSchema: C;
			inputSchema: I;
			runner: StreamRunner<
				StandardSchemaV1.InferOutput<I>,
				StandardSchemaV1.InferOutput<C>,
				GlobalCtx & SafePluginContext<StreamCtx, Use, ValidIds>
			>;
			beforeRun?: (
				args: BeforeRunArgs<
					StandardSchemaV1.InferOutput<I>,
					GlobalCtx & SafePluginContext<StreamCtx, Use, ValidIds>
				>
			) => Promise<StandardSchemaV1.InferOutput<I>> | StandardSchemaV1.InferOutput<I>;
			afterRun?: (
				args: AfterRunArgs<GlobalCtx & SafePluginContext<StreamCtx, Use, ValidIds>>
			) => Promise<void> | void;
			storageProvider?: StreamStorageProvider<StandardSchemaV1.InferOutput<C>>;
			throttleMs?: number;
		}
		: {
			use?: Use;
			chunkSchema: C;
			runner: StreamRunner<
				unknown,
				StandardSchemaV1.InferOutput<C>,
				GlobalCtx & SafePluginContext<StreamCtx, Use, ValidIds>
			>;
			beforeRun?: (
				args: BeforeRunArgs<unknown, GlobalCtx & SafePluginContext<StreamCtx, Use, ValidIds>>
			) => Promise<unknown> | unknown;
			afterRun?: (
				args: AfterRunArgs<GlobalCtx & SafePluginContext<StreamCtx, Use, ValidIds>>
			) => Promise<void> | void;
			storageProvider?: StreamStorageProvider<StandardSchemaV1.InferOutput<C>>;
			throttleMs?: number;
		}
) => StreamDefinitionConfig<C, I, Use>;

export function riverConfig<
	const P extends readonly PluginDescriptor<any, any, any, any>[]
>(config: {
	plugins: P;
	options?: RiverServerOptions;
} & PluginConfigsFromDescriptors<P>) {
	type GlobalCtx = InferGlobalPluginsContextFromDescriptors<P>;
	type AllStreamCtx = InferStreamPluginsContextFromDescriptors<P>;
	type StreamIds = StreamPluginIdsFromDescriptors<P>;

	const stream: StreamDefiner<GlobalCtx, AllStreamCtx, StreamIds> = (streamConfig) => {
		return streamConfig as any;
	};

	return {
		stream,
		_config: config,
		_types: {} as { GlobalCtx: GlobalCtx; StreamCtx: AllStreamCtx; StreamIds: StreamIds }
	};
}

type ConfigToDefinition<T> = T extends StreamDefinitionConfig<infer C, infer I, infer U>
	? StreamDefinition<
		I extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<I> : unknown,
		StandardSchemaV1.InferOutput<C>,
		any
	>
	: T extends StreamDefinition<any, any, any>
	? T
	: never;

type ConvertStreamConfigs<T> = {
	[K in keyof T]: ConfigToDefinition<T[K]>
};

export function riverServer<
	const S extends Record<string, StreamDefinitionConfig<any, any, any>>
>(
	config: { _config: any; _types: any; stream: any },
	streams: S
): {
	streams: ConvertStreamConfigs<S>;
	toEndpoint: () => {
		OPTIONS: (event: RequestEvent) => Promise<Response>;
		POST: (event: RequestEvent) => Promise<Response>;
	};
} {
	const actualConfig = config._config;
	const providedStreams = streams;
	const pluginIds = new Set(actualConfig.plugins.map((p: PluginDescriptor<any, any, any, any>) => p.id));
	const configKeys = Object.keys(actualConfig).filter(key => key !== 'plugins' && key !== 'options');
	for (const configKey of configKeys) {
		if (!pluginIds.has(configKey)) {
			throw new Error(`Invalid config key "${configKey}". Must match a plugin ID from plugins array.`);
		}
	}

	const plugins: RiverPluginReturn<any>[] = [];
	const serverOptions: RiverServerOptions = actualConfig.options || {};

	const registry: Record<string, StreamDefinition<any, any, any>> = {};
	const defaultStorageProvider = createDefaultStorageProvider<any>();

	const ctx: PluginContext = {
		getStream: (name: string) => registry[name]
	};

	const initPlugin = (descriptor: PluginDescriptor<any, any, any, any>) => {
		const pluginConfig = (actualConfig as any)[descriptor.id];
		if (pluginConfig === undefined) {
			throw new Error(`Missing configuration for plugin "${descriptor.id}". Expected a "${descriptor.id}" property in the server config.`);
		}

		const plugin = descriptor.createPlugin(pluginConfig);
		const instance = plugin(ctx);
		plugins.push(instance);
		instance.onInit?.();
	};

	actualConfig.plugins.forEach(initPlugin);

	const globalPlugins = plugins.filter((p) => p.scope === 'global');
	const streamPlugins = plugins.filter((p) => p.scope === 'stream');

	const streamPluginMap = new Map(streamPlugins.map((p) => [p.id, p]));

	const applyRunnerWrappers = <I, C>(
		runner: StreamRunner<I, C, any>,
		usePlugins?: readonly string[]
	): StreamRunner<I, C, any> => {
		let wrapped = runner;

		for (const p of globalPlugins) {
			if (p.wrapRunner) {
				wrapped = p.wrapRunner(wrapped);
			}
		}

		if (usePlugins) {
			for (const pluginId of usePlugins) {
				const plugin = streamPluginMap.get(pluginId);
				if (plugin?.wrapRunner) {
					wrapped = plugin.wrapRunner(wrapped);
				}
			}
		}

		return wrapped;
	};

	const buildExtendedContext = (meta: BaseStreamContext, usePlugins?: readonly string[]): any => {
		let extendedContext = {};

		for (const p of globalPlugins) {
			if (p.extendRunnerContext) {
				const pluginContext = p.extendRunnerContext(meta);
				extendedContext = { ...extendedContext, ...pluginContext };
			}
			if (p.onStreamInfo) {
			}
		}

		if (usePlugins && usePlugins.length > 0) {
			for (const pluginId of usePlugins) {
				const plugin = streamPluginMap.get(pluginId);
				if (plugin?.extendRunnerContext) {
					const pluginContext = plugin.extendRunnerContext(meta);
					extendedContext = { ...extendedContext, ...pluginContext };
				}
				if (plugin?.onStreamInfo) {
				}
			}
		}

		return extendedContext;
	};

	const getCorsHeaders = (requestOrigin: string | null): Record<string, string> => {
		const corsHeaders: Record<string, string> = {};
		if (serverOptions.cors && requestOrigin) {
			const { origin, credentials } = serverOptions.cors;

			let allowed = false;
			if (typeof origin === 'string') {
				allowed = origin === '*' || origin === requestOrigin;
			} else if (Array.isArray(origin)) {
				allowed = origin.includes(requestOrigin);
			} else if (typeof origin === 'function') {
				allowed = origin(requestOrigin);
			}

			if (allowed) {
				corsHeaders['Access-Control-Allow-Origin'] = origin === '*' ? '*' : requestOrigin;
				if (credentials) {
					corsHeaders['Access-Control-Allow-Credentials'] = 'true';
				}
			}
		}
		return corsHeaders;
	};

	type InferredStreams = ConvertStreamConfigs<typeof providedStreams>;

	const streamMap: Record<string, StreamDefinition<any, any, any>> = {};
	for (const [name, streamConfig] of Object.entries(providedStreams)) {
		const fullDef = {
			...streamConfig,
			name,
			use: streamConfig.use ?? []
		} as StreamDefinition<any, any, any>;
		streamMap[name] = fullDef;
		registry[name] = fullDef;
	}
	const typedStreams = streamMap as InferredStreams;

	return {
		get streams(): InferredStreams {
			return typedStreams;
		},
		toEndpoint: () => ({
			async OPTIONS(event: RequestEvent) {
				const corsHeaders = getCorsHeaders(event.request.headers.get('origin'));
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
				for (const p of plugins) {
					await p.onRequest?.(event);
				}

				let body: { name?: unknown; input?: unknown; runId?: unknown };
				try {
					body = await event.request.json();
				} catch {
					return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
						status: 400,
						headers: { 'Content-Type': 'application/json' }
					});
				}

				const name = body?.name;
				if (!name || typeof name !== 'string') {
					return new Response(JSON.stringify({ error: 'Missing stream name' }), {
						status: 400,
						headers: { 'Content-Type': 'application/json' }
					});
				}

				const def = registry[name as keyof typeof registry] as StreamDefinition<any, any, any> | undefined;
				if (!def) {
					return new Response(JSON.stringify({ error: `Unknown stream: ${name}` }), {
						status: 404,
						headers: { 'Content-Type': 'application/json' }
					});
				}

				let parsedInput: any = body?.input;
				if (def.inputSchema) {
					const result = def.inputSchema['~standard'].validate(body?.input);
					const validationResult = result instanceof Promise ? await result : result;

					if (validationResult.issues) {
						return new Response(
							JSON.stringify({
								error: 'Invalid input',
								details: validationResult.issues[0]?.message || 'Validation failed'
							}),
							{ status: 400, headers: { 'Content-Type': 'application/json' } }
						);
					}
					parsedInput = validationResult.value;
				}

				const abortController = new AbortController();
				const runner = applyRunnerWrappers(def.runner, def.use);
				const corsHeaders = getCorsHeaders(event.request.headers.get('origin'));

				const baseMeta: BaseStreamContext = { event };
				const extendedContext = buildExtendedContext(baseMeta, def.use);

				const runId = (body?.runId && typeof body.runId === 'string')
					? body.runId
					: crypto.randomUUID();

				if (def.beforeRun) {
					try {
						parsedInput = await def.beforeRun({
							input: parsedInput,
							meta: baseMeta,
							runId,
							abortSignal: abortController.signal,
							...extendedContext
						});
					} catch (e) {
						return new Response(
							JSON.stringify({
								error: 'beforeRun hook failed',
								details: e instanceof Error ? e.message : 'Unknown error'
							}),
							{ status: 500, headers: { 'Content-Type': 'application/json' } }
						);
					}
				}

				const stream = createSSEStream(
					async ({ send, abortSignal }) => {
						const storageProvider = (def.storageProvider ?? defaultStorageProvider) as StreamStorageProvider<any>;
						const storage = await storageProvider.createStorageSession({ runId, streamName: name });
						const storageInfo = storage?.getStreamInfo();
						const streamInfo: StreamInfo = {
							runId,
							streamId: storageInfo?.streamId ?? null,
							isResumable: storageInfo?.isResumable ?? false
						};

						for (const p of plugins) {
							await p.onStreamInfo?.(streamInfo, name);
						}

						const startEvent: StreamLifecycleStartEvent = {
							[RIVER_STREAM_EVENT_KEY]: 'stream_start',
							runId: streamInfo.runId,
							streamId: streamInfo.streamId,
							isResumable: streamInfo.isResumable
						};

						send(startEvent);

						let status: StreamRunStatus = 'success';
						let chunkCount = 0;
						const startTime = Date.now();
						const throttleMs = typeof def.throttleMs === 'number' && def.throttleMs > 0 ? def.throttleMs : 0;
						let lastEmittedAt = 0;
						let emitQueue: Promise<void> = Promise.resolve();

						const failStream = (error: unknown) => {
							status = 'error';
							console.error(`Stream "${name}" emit failed:`, error);
							if (!abortSignal.aborted) {
								abortController.abort();
							}
						};

						const emitInternal = async (chunk: unknown): Promise<void> => {
							if (throttleMs > 0) {
								const now = Date.now();
								const elapsed = now - lastEmittedAt;
								if (lastEmittedAt && elapsed < throttleMs) {
									await new Promise((resolve) => setTimeout(resolve, throttleMs - elapsed));
								}
								lastEmittedAt = Date.now();
							}

							const result = def.chunkSchema['~standard'].validate(chunk);
							const validationResult = result instanceof Promise ? await result : result;

							if (validationResult.issues) {
								failStream(validationResult.issues);
								return;
							}

							let transformed = validationResult.value;
							for (const p of plugins) {
								const transformedChunk = p.transformChunk?.(transformed, name);
								if (transformedChunk !== undefined) {
									transformed = transformedChunk;
								}
								const observedChunk = p.onChunk?.(transformed, name);
								if (observedChunk !== undefined) {
									transformed = observedChunk;
								}
							}

							chunkCount += 1;
							storage.append(transformed);
							send(transformed);
						};

						const scheduleEmit = (chunk: unknown) => {
							emitQueue = emitQueue.then(() => emitInternal(chunk)).catch(failStream);
						};

						try {
							await runner({
								input: parsedInput,
								appendChunk: (chunk: unknown) => {
									scheduleEmit(chunk);
								},
								meta: baseMeta,
								abortSignal,
								runId,
								...extendedContext
							});

							if (abortSignal.aborted) {
								status = 'canceled';
							}
						} catch (e) {
							if (abortSignal.aborted) {
								status = 'canceled';
							} else {
								status = 'error';
								console.error(`Stream "${name}" failed:`, e);
							}
						} finally {
							await emitQueue;
							const durationMs = Math.max(0, Date.now() - startTime);
							const endEvent: StreamLifecycleEndEvent = {
								[RIVER_STREAM_EVENT_KEY]: 'stream_end',
								runId: streamInfo.runId,
								streamId: streamInfo.streamId,
								status,
								totalChunks: chunkCount,
								durationMs
							};

							send(endEvent);
							storage.close({ status, totalChunks: chunkCount, durationMs });

							const pluginStatus = status === 'canceled' ? 'error' : status;
							for (const p of plugins) {
								await p.onComplete?.(pluginStatus, name);
								await p.onStreamEnd?.(endEvent, name);
							}

							if (def.afterRun) {
								try {
									await def.afterRun({
										status,
										runId,
										meta: baseMeta,
										...extendedContext
									});
								} catch (e) {
									console.error(`afterRun hook failed for "${name}":`, e);
								}
							}
						}
					},
					abortController,
					{
						heartbeatInterval: serverOptions.heartbeatInterval,
						onHeartbeat: async () => {
							for (const p of plugins) {
								try {
									await p.onHeartbeat?.(name);
								} catch (error) {
									console.error(`Heartbeat hook failed for plugin "${p.id}" on stream "${name}":`, error);
								}
							}
						}
					}
				);

				return new Response(stream, {
					headers: {
						'Content-Type': 'text/event-stream',
						'Cache-Control': 'no-cache',
						'Connection': 'keep-alive',
						'X-Accel-Buffering': 'no',
						...corsHeaders
					}
				});
			}
		})
	};
}
