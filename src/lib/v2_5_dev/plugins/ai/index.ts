import type { LanguageModel, StreamTextResult, ToolSet, ModelMessage } from 'ai';
import { streamText } from 'ai';
import type { BaseStreamContext } from '../../types.js';
import { createRiverPlugin } from '../internal/create-river-plugin.js';
import { defineContext } from '../internal/plugin-context.js';
import type {
	AIHelpers,
	AIPluginConfig,
	AIPluginDescriptor,
	NormalizedStreamPart,
	StreamTextOptions
} from './types.js';

const createAIHelpers = (config: AIPluginConfig, meta: BaseStreamContext): AIHelpers => {
	const availableModels = Object.keys(config.models);

	const resolveModelId = (requested?: string): string => {
		const modelId = requested ?? config.defaultModel;
		if (!modelId) {
			const availableList = availableModels.join(', ') || 'none';
			throw new Error(
				`No model specified for AI stream and no defaultModel configured. Available models: ${availableList}`
			);
		}
		return modelId;
	};

	const getAIModel = (requested?: string): LanguageModel => {
		const modelId = resolveModelId(requested);
		const model = config.models[modelId];
		if (!model) {
			throw new Error(
				`Model "${modelId}" not found in server config. Available models: ${availableModels.join(', ')}`
			);
		}
		return model;
	};

	const coerceMessages = (prompt?: string, messages?: ModelMessage[]): ModelMessage[] => {
		const output: ModelMessage[] = messages ? [...messages] : [];
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
			}) as StreamTextResult<T, never>;
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

export function ai(): AIPluginDescriptor {
	return {
		id: 'ai',
		scope: 'stream',
		createPlugin: (config: AIPluginConfig) => {
			if (config.defaultModel && !config.models[config.defaultModel]) {
				const availableModels = Object.keys(config.models).join(', ') || 'none';
				throw new Error(
					`defaultModel "${config.defaultModel}" not found in AI plugin config. Available models: ${availableModels}`
				);
			}

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

export type {
	AIPluginConfig,
	AIHelpers,
	StreamTextOptions,
	ToolEvent,
	NormalizedStreamPart,
	AIPluginDescriptor
} from './types.js';
