import type { RequestEvent } from '@sveltejs/kit';
import type {
	StreamDefinition,
	RiverPlugin,
	RiverMiddleware,
	StreamRunner,
	RiverServerConfig
} from './types.js';
import { createSseStream } from './sse.js';

export function riverServer<const T extends Record<string, any>>(config: {
	plugins?: RiverPlugin[];
	streams: T;
	options?: RiverServerConfig;
}) {
	const registry = config.streams;
	const plugins: ReturnType<RiverPlugin>[] = [];
	const middlewares: RiverMiddleware[] = [];
	const serverOptions = config.options || {};

	const ctx = {
		getStream: (name: string) => registry[name as keyof T],
		addMiddleware: (mw: RiverMiddleware) => middlewares.push(mw)
	};

	const initPlugin = (p: RiverPlugin) => {
		const instance = p(ctx);
		plugins.push(instance);
		instance.onInit?.();
	};

	config.plugins?.forEach(initPlugin);

	const applyRunnerWrappers = <I, C>(runner: StreamRunner<I, C>): StreamRunner<I, C> => {
		let wrapped = runner;
		for (const p of plugins) {
			if (p.wrapRunner) {
				wrapped = p.wrapRunner(wrapped);
			}
		}
		return wrapped;
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
		get: <K extends keyof T>(name: K): T[K] => registry[name],
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

				const def = registry[name as keyof T] as StreamDefinition<any, any> | undefined;
				if (!def) {
					return new Response(JSON.stringify({ error: `Unknown stream: ${name}` }), {
						status: 404,
						headers: { 'Content-Type': 'application/json' }
					});
				}

				let currentInput = body?.input;
				for (const mw of middlewares) {
					const result = await mw({ event, streamName: name, input: currentInput });
					if (result.continue === false) {
						return result.response;
					}
					if (result.input !== undefined) {
						currentInput = result.input;
					}
				}

				let parsedInput: any = currentInput;
				if (def.inputSchema) {
					const result = def.inputSchema['~standard'].validate(currentInput);
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

						try {
							await runner({
								input: parsedInput,
								appendChunk: emit,
								meta: { event },
								abortSignal
							});
							for (const p of plugins) {
								await p.onComplete?.('success', name);
							}
						} catch (e) {
							console.error(`Stream "${name}" failed:`, e);
							for (const p of plugins) {
								await p.onComplete?.('error', name);
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
