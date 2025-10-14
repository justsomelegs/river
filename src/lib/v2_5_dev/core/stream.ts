import type { BaseStreamContext, StreamRunStatus } from './lifecycle.js';
import type { StreamStorageAdapter } from './storage.js';
import type { StandardSchemaV1 } from './standard-schema.js';

export type StreamRunnerArgs<Input, Chunk> = {
	input: Input;
	appendChunk: (chunk: Chunk) => void;
	meta: BaseStreamContext;
	abortSignal: AbortSignal;
	runId: string;
};

export type StreamRunner<Input, Chunk, Context = {}> = (
	args: StreamRunnerArgs<Input, Chunk> & Context
) => Promise<void> | void;

export type BeforeRunArgs<Input, Context = {}> = {
	input: Input;
	meta: BaseStreamContext;
	runId: string;
	abortSignal: AbortSignal;
} & Context;

export type AfterRunArgs<Context = {}> = {
	status: 'success' | 'error' | 'canceled';
	runId: string;
	meta: BaseStreamContext;
} & Context;

export type StreamDefinition<Input = unknown, Chunk = unknown, Context = {}> = {
	name: string;
	use?: readonly string[];
	chunkSchema: StandardSchemaV1<unknown, Chunk>;
	inputSchema?: StandardSchemaV1<unknown, Input>;
	runner: StreamRunner<Input, Chunk, Context>;
	beforeRun?: (args: BeforeRunArgs<Input, Context>) => Promise<Input> | Input;
	afterRun?: (args: AfterRunArgs<Context>) => Promise<void> | void;
	storage?: StreamStorageAdapter<Chunk>;
	throttleMs?: number;
};

export type StreamDefinitionConfig<
	C extends StandardSchemaV1,
	I extends StandardSchemaV1 | undefined = undefined,
	Context = unknown,
	Use extends readonly string[] = []
> = I extends StandardSchemaV1
	? {
			use?: Use;
			chunkSchema: C;
			inputSchema: I;
			runner: StreamRunner<
				StandardSchemaV1.InferOutput<I>,
				StandardSchemaV1.InferOutput<C>,
				Context
			>;
			beforeRun?: (
				args: BeforeRunArgs<StandardSchemaV1.InferOutput<I>, Context>
			) => Promise<StandardSchemaV1.InferOutput<I>> | StandardSchemaV1.InferOutput<I>;
			afterRun?: (args: AfterRunArgs<Context>) => Promise<void> | void;
			storage?: StreamStorageAdapter<StandardSchemaV1.InferOutput<C>>;
			throttleMs?: number;
		}
	: {
			use?: Use;
			chunkSchema: C;
			runner: StreamRunner<unknown, StandardSchemaV1.InferOutput<C>, Context>;
			beforeRun?: (args: BeforeRunArgs<unknown, Context>) => Promise<unknown> | unknown;
			afterRun?: (args: AfterRunArgs<Context>) => Promise<void> | void;
			storage?: StreamStorageAdapter<StandardSchemaV1.InferOutput<C>>;
			throttleMs?: number;
		};

export type StreamDefinitionMap = Record<string, StreamDefinition<any, any, any>>;

export type StreamInputType<T extends StreamDefinition<any, any, any>> =
	T extends StreamDefinition<infer Input, any, any> ? Input : never;

export type StreamChunkType<T extends StreamDefinition<any, any, any>> =
	T extends StreamDefinition<any, infer Chunk, any> ? Chunk : never;

export type StreamCompletionSummary = {
	status: StreamRunStatus;
	totalChunks: number;
	durationMs: number;
	runId: string;
	streamId: string | null;
};
