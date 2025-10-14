import type { LanguageModel, ToolSet, CoreMessage, TextStreamPart, StreamTextResult } from 'ai';
import type { BaseStreamContext, PluginDescriptor } from '../../types.js';

export interface AIPluginConfig {
	models: Record<string, LanguageModel>;
	defaultModel?: string;
}

export interface StreamTextOptions<TOOLS extends ToolSet> {
	model?: string;
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

export type AIPluginDescriptor = PluginDescriptor<
	AIPluginConfig,
	{ ai: AIHelpers },
	'stream',
	'ai'
>;

export type CreateAIHelpers = (config: AIPluginConfig, meta: BaseStreamContext) => AIHelpers;
