import type { LanguageModel, StreamTextResult, ToolSet, CoreMessage } from 'ai';
import { streamText } from 'ai';
import type { BaseStreamContext, RiverPlugin } from '../types.js';
import { createRiverPlugin } from './internal/create-river-plugin.js';
import { defineContext } from './internal/plugin-context.js';

// define then config shape if it needs one.
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

// define helper functions for the plugin.
export interface AIHelpers {
	streamText: <TOOLS extends ToolSet>(
		options: StreamTextOptions<TOOLS>
	) => StreamTextResult<TOOLS, never>;

	pipeTextStream: <T extends ToolSet>(
		result: StreamTextResult<T, any>,
		appendChunk: (chunk: string) => void,
		abortSignal: AbortSignal
	) => Promise<void>;
}

// create helper functions that are passed onto the server
// POTENTIAL TODO -> maybe refactor into an internal helper function so less type assignments are needed? not sure.
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

	return {
		streamText: <T extends ToolSet>(options: StreamTextOptions<T>) => {
			const model = getAIModel(options.model);
			const messages: CoreMessage[] = options.messages ? [...options.messages] : [];

			if (options.prompt) {
				messages.push({ role: 'user', content: options.prompt });
			}

			const result = streamText({
				model,
				messages,
				system: options.system,
				temperature: options.temperature,
				tools: options.tools,
				abortSignal: meta.event.request.signal
			});

			return result;
		},

		pipeTextStream: async (result, appendChunk, abortSignal) => {
			try {
				for await (const chunk of result.textStream) {
					if (abortSignal.aborted) {
						break;
					}
					appendChunk(chunk);
				}
			} catch (e) {
				if (!abortSignal.aborted) {
					throw e;
				}
			}
		}
	};
};

// assemble the pieces of the plugin.
// (again this is could be a temporary API just messing around with things for now)
export function ai(config: AIPluginConfig): RiverPlugin<{ ai: AIHelpers }, 'stream'> {
	const context = defineContext({
		ai: (meta) => createAIHelpers(config, meta)
	});

	return createRiverPlugin<{ ai: AIHelpers }, 'stream'>({
		id: 'ai',
		scope: 'stream',
		extend: (meta) => context.create(meta)
	});
}
