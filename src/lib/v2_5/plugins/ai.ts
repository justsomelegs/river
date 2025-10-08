import type { LanguageModel, StreamTextResult, ToolSet, CoreMessage } from 'ai';
import { streamText } from 'ai';
import type { RiverPlugin } from '../types.js';

export interface AIPluginConfig {
	models: Record<string, LanguageModel>;
	defaultModel?: string;
}

export interface StreamTextOptions<TOOLS extends ToolSet = {}> {
	model: string;
	prompt?: string;
	messages?: CoreMessage[];
	system?: string;
	temperature?: number;
	maxTokens?: number;
	tools?: TOOLS;
}

export interface AIHelpers {
	/**
	 * Stream text with full type inference for tools
	 */
	streamText: <TOOLS extends ToolSet = {}>(
		options: StreamTextOptions<TOOLS>
	) => StreamTextResult<TOOLS, never>;

	/**
	 * Pipe AI SDK textStream to River stream
	 */
	pipeTextStream: <T extends ToolSet>(
		result: StreamTextResult<T, any>,
		appendChunk: (chunk: string) => void,
		abortSignal: AbortSignal
	) => Promise<void>;
}

export function AI(config: AIPluginConfig): RiverPlugin<{ ai: AIHelpers }> {
	return () => ({
		id: 'ai',

		extendRunnerContext: (meta) => {
			const getModel = (modelId: string): LanguageModel => {
				const model = config.models[modelId];
				if (!model) {
					const availableModels = Object.keys(config.models).join(', ');
					throw new Error(`Model "${modelId}" not found. Available models: ${availableModels}`);
				}
				return model;
			};

			const helpers: AIHelpers = {
				streamText: <TOOLS extends ToolSet = {}>(options: StreamTextOptions<TOOLS>) => {
					const model = getModel(options.model);

					const messages: CoreMessage[] = options.messages || [];

					// If prompt provided, add as user message
					if (options.prompt) {
						messages.push({ role: 'user', content: options.prompt });
					}

					const result = streamText({
						model,
						messages,
						system: options.system,
						temperature: options.temperature,
						maxTokens: options.maxTokens,
						tools: options.tools,
						abortSignal: meta.event.request.signal
					} as any);

					return result as unknown as StreamTextResult<TOOLS, never>;
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

			return { ai: helpers };
		}
	});
}
