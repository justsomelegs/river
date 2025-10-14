import { riverServer, riverConfig } from '$lib/v2_5_dev/server/index.js';
import { ai } from '$lib/v2_5_dev/plugins/ai/index.js';
import { createInMemoryStorageAdapter, getStoredStream } from '$lib/v2_5_dev/storage/in-memory.js';
import { z } from 'zod';
import { OPENROUTER_API_KEY } from '$env/static/private';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { tool } from 'ai';

const openrouter = createOpenRouter({
	apiKey: OPENROUTER_API_KEY
});

const river = riverConfig({
	plugins: [ai()],
	ai: {
		models: {
			'gpt-4o-mini': openrouter('openai/gpt-4o-mini'),
			llama: openrouter('meta-llama/llama-4-maverick:free')
		},
		defaultModel: 'gpt-4o-mini'
	},
	options: {
		heartbeatInterval: 30000,
		cors: {
			origin: '*',
			credentials: true
		}
	}
});

const vowelSet = new Set(['a', 'e', 'i', 'o', 'u']);

const normalizeWords = (phrase: string) =>
	phrase
		.split(/\s+/)
		.map((word) => ({
			original: word,
			normalized: word.replace(/[^a-zA-Z]/g, '').toLowerCase()
		}))
		.filter(({ normalized }) => normalized.length > 0);

const analyzerStats = new Map<string, { chunks: number; durationMs: number; notes: string[] }>();

const textAnalyzer = river.stream({
	chunkSchema: z
		.object({
			index: z.number(),
			word: z.string(),
			normalized: z.string(),
			length: z.number(),
			vowels: z.number(),
			consonants: z.number(),
			isPalindrome: z.boolean()
		})
		.strict(),
	inputSchema: z
		.object({
			phrase: z.string().min(1, 'Please provide some text'),
			repeat: z.number().int().min(1).max(5).default(1),
			uppercase: z.boolean().default(false)
		})
		.strict(),
	throttleMs: 75,
	beforeRun: async ({ input }) => {
		const phrase = input.uppercase ? input.phrase.toUpperCase() : input.phrase;
		const cleaned = phrase.replace(/\s+/g, ' ').trim();

		return {
			phrase: cleaned,
			repeat: input.repeat,
			uppercase: input.uppercase
		};
	},
	afterRun: async ({ status, runId }) => {
		const stats = analyzerStats.get(runId);
		if (stats) {
			console.log(
				`[textAnalyzer:${runId}] status=${status} chunks=${stats.chunks} duration=${stats.durationMs}ms notes=${stats.notes.join(
					'|'
				)}`
			);
			analyzerStats.delete(runId);
		} else {
			console.log(`[textAnalyzer:${runId}] status=${status}`);
		}
	},
	runner: async ({ input, appendChunk, abortSignal, runId }) => {
		const segments = normalizeWords(input.phrase);
		let index = 0;
		let emitted = 0;
		const notes: string[] = [];
		const startedAt = Date.now();

		for (let iteration = 0; iteration < input.repeat; iteration += 1) {
			for (const segment of segments) {
				if (abortSignal.aborted) {
					notes.push('aborted mid-run');
					analyzerStats.set(runId, {
						chunks: emitted,
						durationMs: Math.max(0, Date.now() - startedAt),
						notes
					});
					return;
				}

				const characters = segment.normalized.split('');
				const vowelCount = characters.filter((char) => vowelSet.has(char)).length;
				const consonantCount = Math.max(0, segment.normalized.length - vowelCount);

				const chunk = {
					index,
					word: segment.original,
					normalized: segment.normalized,
					length: segment.normalized.length,
					vowels: vowelCount,
					consonants: consonantCount,
					isPalindrome: segment.normalized === [...segment.normalized].reverse().join('')
				};

				appendChunk(chunk);
				index += 1;
				emitted += 1;

				if (input.repeat > 1 && iteration < input.repeat - 1 && segment === segments.at(-1)) {
					notes.push(`iteration ${iteration + 1} completed`);
				}
			}
		}

		analyzerStats.set(runId, {
			chunks: emitted,
			durationMs: Math.max(0, Date.now() - startedAt),
			notes
		});
	}
});

const knowledgeTool = tool({
	name: 'fact_check',
	description: 'Look up structured data to answer factual questions.',
	inputSchema: z
		.object({
			subject: z.string(),
			detail: z.string().optional()
		})
		.strict(),
	execute: async ({ subject }) => {
		const cannedFacts: Record<string, string> = {
			svelte: 'Svelte is a compiler for building fast web applications.',
			sse: 'Server-Sent Events provide one-way streaming over HTTP.',
			'river v2.5':
				'River v2.5 adds resumable streams, plugins, and unified server/client semantics.'
		};

		return {
			source: 'demo-dataset',
			result: cannedFacts[subject.toLowerCase()] ?? `No cached fact for "${subject}".`
		};
	}
});

const aiWorkbench = river.stream({
	use: ['ai'],
	chunkSchema: z
		.object({
			type: z.enum(['assistant-text', 'tool-call', 'tool-result', 'done']),
			text: z.string().optional(),
			toolName: z.string().optional(),
			toolInput: z.unknown().optional(),
			toolOutput: z.unknown().optional()
		})
		.strict(),
	inputSchema: z
		.object({
			prompt: z.string().min(1, 'Provide a prompt to the assistant.'),
			tone: z.enum(['neutral', 'playful', 'serious']).default('neutral'),
			requireTool: z.boolean().default(true)
		})
		.strict(),
	runner: async ({ input, appendChunk, ai, abortSignal }) => {
		const toneInstructions: Record<typeof input.tone, string> = {
			neutral:
				'Respond in a friendly but concise tone. Use lists when helpful and end with a short summary.',
			playful: 'Adopt a playful style with light humor, but keep the response informative.',
			serious: 'Provide a formal, direct response focusing on the key facts the user needs.'
		};

		const result = ai.streamText({
			model: input.requireTool ? 'gpt-4o-mini' : 'llama',
			prompt: input.prompt,
			system: toneInstructions[input.tone],
			tools: input.requireTool
				? {
						fact_check: knowledgeTool
					}
				: undefined,
			temperature: input.tone === 'serious' ? 0.4 : 0.7
		});

		try {
			for await (const part of result.fullStream) {
				if (abortSignal.aborted) {
					break;
				}

				switch (part.type) {
					case 'text-delta': {
						if (part.text.length > 0) {
							appendChunk({ type: 'assistant-text', text: part.text });
						}
						break;
					}
					case 'reasoning-delta': {
						if (part.text.length > 0) {
							appendChunk({ type: 'assistant-text', text: part.text });
						}
						break;
					}
					case 'tool-call': {
						appendChunk({
							type: 'tool-call',
							toolName: part.toolName,
							toolInput: part.input
						});
						break;
					}
					case 'tool-result': {
						appendChunk({
							type: 'tool-result',
							toolName: part.toolName,
							toolInput: part.input,
							toolOutput: part.output
						});
						break;
					}
					default: {
						if ('text' in part && typeof part.text === 'string' && part.text.length > 0) {
							appendChunk({ type: 'assistant-text', text: part.text });
						}
					}
				}
			}
		} catch (error) {
			if (!abortSignal.aborted) {
				throw error;
			}
		} finally {
			appendChunk({ type: 'done' });
		}
	}
});

const transcriptStorage = createInMemoryStorageAdapter<{ index: number; data: string }>();

const resumableTranscript = river.stream({
	chunkSchema: z
		.object({
			index: z.number(),
			data: z.string()
		})
		.strict(),
	inputSchema: z
		.object({
			count: z.number().int().min(1).max(200).default(20)
		})
		.strict(),
	storage: transcriptStorage,
	runner: async ({ input, appendChunk, abortSignal, runId }) => {
		const stored = getStoredStream(transcriptStorage, runId);
		const startIndex = stored ? stored.chunks.length : 0;

		for (let index = startIndex; index < input.count; index += 1) {
			if (abortSignal.aborted) {
				break;
			}
			appendChunk({ index, data: `Segment ${index + 1}` });
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	}
});

const diagnosticsStream = river.stream({
	chunkSchema: z
		.object({
			stage: z.enum(['start', 'running', 'completed']),
			message: z.string(),
			ts: z.number()
		})
		.strict(),
	inputSchema: z
		.object({
			mode: z.enum(['success', 'fail-chunk', 'throw-error']).default('fail-chunk')
		})
		.strict(),
	runner: async ({ input, appendChunk }) => {
		const now = () => Date.now();
		appendChunk({ stage: 'start', message: `Mode: ${input.mode}`, ts: now() });

		if (input.mode === 'throw-error') {
			throw new Error('Diagnostics runner threw an intentional error.');
		}

		appendChunk({ stage: 'running', message: 'All systems nominal.', ts: now() });

		if (input.mode === 'fail-chunk') {
			// This chunk intentionally violates the chunk schema (extra property) to trigger a validation failure.
			appendChunk({
				stage: 'running',
				message: 'Sending an invalid payload to test validation failure.',
				ts: now(),
				extra: 'boom'
			} as unknown as { stage: 'running'; message: string; ts: number });
			return;
		}

		appendChunk({ stage: 'completed', message: 'Diagnostic sequence completed.', ts: now() });
	}
});

const server = riverServer(river, {
	textAnalyzer,
	aiWorkbench,
	resumableTranscript,
	diagnosticsStream
});

export const { POST, OPTIONS } = server.toEndpoint();
export type River = typeof server.streams;
