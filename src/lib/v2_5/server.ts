import type { RequestEvent } from '@sveltejs/kit';
import type {
	StreamDefinition,
	RiverPlugin,
	StreamRunner,
	RiverServerConfig,
	RiverPluginReturn,
	PluginContext,
	BaseStreamContext,
	InferPluginsContext,
	StreamBuilderFn,
	StandardSchemaV1
} from './types.js';
import { createSseStream } from './sse.js';

export function riverServer<
	const P extends readonly RiverPlugin<any>[],
	const T extends Record<string, any>
>(config: {
	plugins?: P;
	streams: (stream: StreamBuilderFn<InferPluginsContext<P>>) => T;
	options?: RiverServerConfig;
}) {
	const streamBuilder: StreamBuilderFn<InferPluginsContext<P>> = <
		C extends StandardSchemaV1,
		I extends StandardSchemaV1 | undefined = undefined
	>(
		streamConfig: any
	) => streamConfig as StreamDefinition<any, any, InferPluginsContext<P>>;

	const registry = config.streams(streamBuilder);
	const plugins: RiverPluginReturn<any>[] = [];
	const serverOptions = config.options || {};

	const ctx: PluginContext = {
		getStream: (name: string) => registry[name as keyof T]
	};

	const initPlugin = (p: RiverPlugin<any>) => {
		const instance = p(ctx);
		plugins.push(instance);
		instance.onInit?.();
	};

	config.plugins?.forEach(initPlugin);

	const applyRunnerWrappers = <I, C>(runner: StreamRunner<I, C, any>): StreamRunner<I, C, any> => {
		let wrapped = runner;
		for (const p of plugins) {
			if (p.wrapRunner) {
				wrapped = p.wrapRunner(wrapped);
			}
		}
		return wrapped;
	};

	const buildExtendedContext = (meta: BaseStreamContext): any => {
		let extendedContext = {};
		for (const p of plugins) {
			if (p.extendRunnerContext) {
				const pluginContext = p.extendRunnerContext(meta);
				extendedContext = { ...extendedContext, ...pluginContext };
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
		use: initPlugin,
		get: <K extends keyof T>(name: K): T[K] => registry[name] as T[K],
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

				const def = registry[name as keyof T] as StreamDefinition<any, any, any> | undefined;
				if (!def) {
					return new Response(JSON.stringify({ error: `Unknown stream: ${name}` }), {
						status: 404,
						headers: { 'Content-Type': 'application/json' }
					});
				}

				// Potential future feature: middleware system for intercepting/transforming requests

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
				const runner = applyRunnerWrappers(def.runner);
				const corsHeaders = getCorsHeaders(event.request.headers.get('origin'));

				const baseMeta: BaseStreamContext = { event };
				const extendedContext = buildExtendedContext(baseMeta);
				const runId = crypto.randomUUID();

				// Call beforeRun hook if defined
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

				const stream = createSseStream(
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
							// Call plugin onComplete hooks
							const pluginStatus = status === 'canceled' ? 'error' : status;
							for (const p of plugins) {
								await p.onComplete?.(pluginStatus, name);
							}

							// Call afterRun hook if defined
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
						Connection: 'keep-alive',
						'X-Accel-Buffering': 'no',
						...corsHeaders
					}
				});
			}
		})
	};
}
