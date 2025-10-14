import type { StreamDefinitionMap, StreamInputType, StreamChunkType } from '../types.js';
import { RiverClientError } from './errors.js';
import {
	type RiverClient,
	type RiverClientConfig,
	type RiverStreamFactory,
	type RiverStreamCaller,
	type RiverFetch,
	type StreamCallerOptions
} from './types.js';
import { InternalRiverStreamCaller } from './stream-caller.js';

export { RiverClientError } from './errors.js';
export type {
	RiverClient,
	RiverClientConfig,
	RiverStreamFactory,
	RiverStreamCaller,
	RiverStreamStatus,
	RiverClientRetryConfig,
	RiverClientLogger,
	RiverFetch,
	StreamCallerOptions,
	RiverStreamEvent,
	StreamStartOptions,
	RiverHttpErrorDetails
} from './types.js';

export function createRiverClient<R extends StreamDefinitionMap>(
	config: RiverClientConfig
): RiverClient<R> {
	const fetchImpl: RiverFetch = config.fetch ?? globalThis.fetch?.bind(globalThis);
	if (!fetchImpl) {
		throw new RiverClientError(
			'Global fetch is not available and no fetch implementation was provided'
		);
	}

	const createInvoker =
		<K extends keyof R>(streamName: K) =>
		(options: StreamCallerOptions<StreamChunkType<R[K]>> = {}) => {
			const caller = new InternalRiverStreamCaller<StreamInputType<R[K]>, StreamChunkType<R[K]>>({
				name: streamName as string,
				endpoint: config.endpoint,
				fetchImpl,
				options,
				retry: config.retry,
				logger: config.logger,
				requestInit: config.requestInit
			});

			const streamCaller: RiverStreamCaller<StreamInputType<R[K]>, StreamChunkType<R[K]>> = {
				get status() {
					return caller.status;
				},
				start: (input, opts) => caller.start(input, opts),
				stop: () => caller.stop(),
				waitForFirstChunk: () => caller.waitForFirstChunk(),
				waitForCompletion: () => caller.waitForCompletion(),
				update: (opts) => caller.update(opts),
				getLastEventId: () => caller.getLastEventId()
			};

			return streamCaller;
		};

	const handler: ProxyHandler<RiverStreamFactory<R>> = {
		get(_target, prop) {
			return typeof prop === 'string' ? createInvoker(prop as keyof R) : undefined;
		}
	};

	const streamFactory = new Proxy({} as RiverStreamFactory<R>, handler);

	return {
		stream: streamFactory
	};
}
