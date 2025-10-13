import type {
	LanguageModel,
	StreamTextResult,
	ToolSet,
	CoreMessage,
	TextStreamPart
} from 'ai';
import { streamText } from 'ai';
import type { BaseStreamContext, RiverPlugin, PluginDescriptor } from '../types.js';
import { createRiverPlugin } from './internal/create-river-plugin.js';
import { defineContext } from './internal/plugin-context.js';

export interface AIPluginConfig {
	models: Record<string, LanguageModel>;
	defaultModel?: string;
}

export interface StreamTextOptions<TOOLS extends ToolSet> {
	model: string;
	prompt?: string;
	messages?: CoreMessage[];
	system?: string;
	temperature?: number;
	tools?: TOOLS;
}

export type ToolEvent<TName extends string, TInput = unknown, TOutput = unknown> = {
	type: 'tool';
	toolName: TName;
	input: TInput;
	output?: TOutput;
};

export type NormalizedStreamPart<Tools extends ToolSet> =
	| TextStreamPart<Tools>
	| ToolEvent<string, unknown, unknown>;

export interface AIHelpers {
	streamText: <TOOLS extends ToolSet>(
		options: StreamTextOptions<TOOLS>
	) => StreamTextResult<TOOLS, never>;

	pipeTextStream: <T extends ToolSet>(
		result: StreamTextResult<T, any>,
		appendChunk: (delta: string) => void,
		abortSignal: AbortSignal
	) => Promise<void>;

	normalizeStream: <T extends ToolSet>(
		result: StreamTextResult<T, any>,
		appendChunk: (chunk: NormalizedStreamPart<T>) => void,
		abortSignal: AbortSignal
	) => Promise<void>;
}

const createAIHelpers = (config: AIPluginConfig, meta: BaseStreamContext): AIHelpers => {
	const getAIModel = (modelId: string): LanguageModel => {
		const model = config.models[modelId];
		if (!model) {
			const availableModels = Object.keys(config.models).join(', ');
			throw new Error(
				`Model "${modelId}" not found in server config. Available models: ${availableModels}`
			);
		}
		return model;
	};

	const coerceMessages = (prompt?: string, messages?: CoreMessage[]): CoreMessage[] => {
		const output: CoreMessage[] = messages ? [...messages] : [];
		if (prompt) {
			output.push({ role: 'user', content: prompt });
		}
		return output;
	};

	return {
		streamText: <T extends ToolSet>(options: StreamTextOptions<T>) => {
			const model = getAIModel(options.model);
			const messages = coerceMessages(options.prompt, options.messages);

			return streamText({
				model,
				messages,
				system: options.system,
				temperature: options.temperature,
				tools: options.tools,
				abortSignal: meta.event.request.signal
			});
		},

		pipeTextStream: async (result, appendChunk, abortSignal) => {
			try {
				for await (const chunk of result.textStream) {
					if (abortSignal.aborted) break;
					appendChunk(chunk);
				}
			} catch (error) {
				if (!abortSignal.aborted) {
					throw error;
				}
			}
		},

		normalizeStream: async (result, appendChunk, abortSignal) => {
			try {
				for await (const chunk of result.fullStream) {
					if (abortSignal.aborted) break;

					appendChunk(chunk);

					if (chunk.type === 'tool-call' && !chunk.dynamic) {
						appendChunk({
							type: 'tool',
							toolName: chunk.toolName,
							input: chunk.input
						});
					}

					if (chunk.type === 'tool-result' && !chunk.dynamic) {
						appendChunk({
							type: 'tool',
							toolName: chunk.toolName,
							input: chunk.input,
							output: chunk.output
						});
					}
				}
			} catch (error) {
				if (!abortSignal.aborted) {
					throw error;
				}
			}
		}
	};
};

export function ai(): PluginDescriptor<AIPluginConfig, { ai: AIHelpers }, 'stream', 'ai'> {
	return {
		id: 'ai',
		scope: 'stream',
		createPlugin: (config: AIPluginConfig) => {
			const context = defineContext({
				ai: (meta) => createAIHelpers(config, meta)
			});

			return createRiverPlugin<{ ai: AIHelpers }, 'stream', 'ai'>({
				id: 'ai',
				scope: 'stream',
				extend: (meta) => context.create(meta)
			});
		}
	};
}
