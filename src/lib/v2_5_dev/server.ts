import type { RequestEvent } from '@sveltejs/kit';
import type {
	StreamDefinition,
	RiverPlugin,
	StreamRunner,
	RiverServerConfig as RiverServerOptions,
	RiverPluginReturn,
	PluginContext,
	BaseStreamContext,
	InferGlobalPluginsContextFromDescriptors,
	InferStreamPluginsContextFromDescriptors,
	StreamPluginIdsFromDescriptors,
	StreamBuilderFn,
	StandardSchemaV1,
	PluginDescriptor,
	PluginDescriptorConfig,
	PluginConfigsFromDescriptors,
	ResolvePlugins,
	BeforeRunArgs,
	AfterRunArgs,
	SafePluginContext
} from './types.js';
import { createSSEStream } from './sse.js';

export function riverServer<
	const P extends readonly PluginDescriptor<any, any, any, any>[]
>(config: {
	plugins: P;
	options?: RiverServerOptions;
} & PluginConfigsFromDescriptors<P>) {
	const pluginIds = new Set(config.plugins.map((p: PluginDescriptor<any, any, any, any>) => p.id));
	const configKeys = Object.keys(config).filter(key => key !== 'plugins' && key !== 'options');
	for (const configKey of configKeys) {
		if (!pluginIds.has(configKey)) {
			throw new Error(`Invalid config key "${configKey}". Must match a plugin ID from plugins array.`);
		}
	}

	const plugins: RiverPluginReturn<any>[] = [];
	const serverOptions: RiverServerOptions = config.options || {};

	const globalPlugins = plugins.filter((p) => p.scope === 'global');
	const streamPlugins = plugins.filter((p) => p.scope === 'stream');

	const streamPluginMap = new Map(streamPlugins.map((p) => [p.id, p]));

	const registry: Record<string, StreamDefinition<any, any, any>> = {};

	const ctx: PluginContext = {
		getStream: (name: string) => registry[name]
	};

	const initPlugin = (descriptor: PluginDescriptor<any, any, any, any>) => {
		const pluginConfig = (config as any)[descriptor.id];
		if (pluginConfig === undefined) {
			throw new Error(`Missing configuration for plugin "${descriptor.id}". Expected a "${descriptor.id}" property in the server config.`);
		}

		const plugin = descriptor.createPlugin(pluginConfig);
		const instance = plugin(ctx);
		plugins.push(instance);
		instance.onInit?.();
	};

	config.plugins.forEach(initPlugin);

	type GlobalCtx = InferGlobalPluginsContextFromDescriptors<P>;
	type AllStreamCtx = InferStreamPluginsContextFromDescriptors<P>;
	type StreamIds = StreamPluginIdsFromDescriptors<P>;

	const createStream = <const Name extends string>(name: Name) => <
		C extends StandardSchemaV1,
		I extends StandardSchemaV1 | undefined = undefined,
		const Use extends readonly string[] = readonly StreamIds[]
	>(
		config: I extends StandardSchemaV1
			? {
				use?: Use;
				chunkSchema: C;
				inputSchema: I;
				runner: StreamRunner<
					StandardSchemaV1.InferOutput<I>,
					StandardSchemaV1.InferOutput<C>,
					GlobalCtx & SafePluginContext<AllStreamCtx, Use, StreamIds>
				>;
				beforeRun?: (
					args: BeforeRunArgs<
						StandardSchemaV1.InferOutput<I>,
						GlobalCtx & SafePluginContext<AllStreamCtx, Use, StreamIds>
					>
				) => Promise<StandardSchemaV1.InferOutput<I>> | StandardSchemaV1.InferOutput<I>;
				afterRun?: (
					args: AfterRunArgs<GlobalCtx & SafePluginContext<AllStreamCtx, Use, StreamIds>>
				) => Promise<void> | void;
			}
			: {
				use?: Use;
				chunkSchema: C;
				runner: StreamRunner<
					unknown,
					StandardSchemaV1.InferOutput<C>,
					GlobalCtx & SafePluginContext<AllStreamCtx, Use, StreamIds>
				>;
				beforeRun?: (
					args: BeforeRunArgs<
						unknown,
						GlobalCtx & SafePluginContext<AllStreamCtx, Use, StreamIds>
					>
				) => Promise<unknown> | unknown;
				afterRun?: (
					args: AfterRunArgs<GlobalCtx & SafePluginContext<AllStreamCtx, Use, StreamIds>>
				) => Promise<void> | void;
			}
	): StreamDefinition<
		I extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<I> : unknown,
		StandardSchemaV1.InferOutput<C>,
		GlobalCtx & SafePluginContext<AllStreamCtx, Use, StreamIds>
	> => {
		if (registry[name]) {
			throw new Error(`Stream "${name}" already defined.`);
		}

		const usePlugins = config.use ?? [];
		const availableIds = new Set(streamPlugins.map((p) => p.id as string));
		for (const id of usePlugins) {
			const idStr = id as string;
			if (!idStr || idStr.trim() === '') {
				throw new Error(
					`Stream "${name}" has invalid plugin ID: empty string. Available plugins: ${Array.from(
						availableIds
					).join(', ')}`
				);
			}
			if (!availableIds.has(idStr)) {
				throw new Error(
					`Stream "${name}" uses unknown plugin "${idStr}". Available: ${Array.from(
						availableIds
					).join(', ')}`
				);
			}
		}

		const def = {
			name,
			use: config.use ?? [],
			...config,
		} as any;

		registry[name] = def as any;
		return def as StreamDefinition<
			I extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<I> : unknown,
			StandardSchemaV1.InferOutput<C>,
			GlobalCtx & SafePluginContext<AllStreamCtx, Use, StreamIds>
		>;
	};

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
		}

		if (usePlugins && usePlugins.length > 0) {
			for (const pluginId of usePlugins) {
				const plugin = streamPluginMap.get(pluginId);
				if (plugin?.extendRunnerContext) {
					const pluginContext = plugin.extendRunnerContext(meta);
					extendedContext = { ...extendedContext, ...pluginContext };
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

	return {
		createStream,
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

				let body: { name?: unknown; input?: unknown };
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
				const runId = crypto.randomUUID();

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
						const emit = (chunk: unknown): void => {
							const result = def.chunkSchema['~standard'].validate(chunk);
							const validationResult = result instanceof Promise ? result : result;

							if (validationResult instanceof Promise) {
								console.error(`Chunk validation must be synchronous for "${name}"`);
								for (const p of plugins) {
									p.onComplete?.('error', name);
								}
								return;
							}

							if (validationResult.issues) {
								console.error(`Chunk validation failed for "${name}":`, validationResult.issues);
								for (const p of plugins) {
									p.onComplete?.('error', name);
								}
								return;
							}

							const validatedChunk = validationResult.value;

							let transformed = validatedChunk;
							for (const p of plugins) {
								const result = p.onChunk?.(transformed, name);
								if (result !== undefined) {
									transformed = result;
								}
							}
							send(transformed);
						};

						let status: 'success' | 'error' | 'canceled' = 'success';

						try {
							await runner({
								input: parsedInput,
								appendChunk: emit,
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
							const pluginStatus = status === 'canceled' ? 'error' : status;
							for (const p of plugins) {
								await p.onComplete?.(pluginStatus, name);
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
						heartbeatInterval: serverOptions.heartbeatInterval
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
