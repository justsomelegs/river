import type { StreamRunner, StreamDefinition, StandardSchemaV1 } from './types.js';

type InferOutput<T> = T extends StandardSchemaV1<any, infer O> ? O : never;

export function defineStream<
	C extends StandardSchemaV1,
	I extends StandardSchemaV1 | undefined = undefined
>(
	config: I extends StandardSchemaV1
		? {
				chunkSchema: C;
				inputSchema: I;
				runner: StreamRunner<InferOutput<I>, InferOutput<C>>;
			}
		: {
				chunkSchema: C;
				runner: StreamRunner<unknown, InferOutput<C>>;
			}
): I extends StandardSchemaV1
	? StreamDefinition<InferOutput<I>, InferOutput<C>>
	: StreamDefinition<unknown, InferOutput<C>> {
	return config as any;
}
