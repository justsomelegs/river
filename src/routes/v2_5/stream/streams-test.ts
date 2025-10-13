import { riverServer, riverConfig, ai, createInMemoryStorageProvider, getStoredStream } from '$lib/v2_5_dev/index.js';
import { OPENROUTER_API_KEY } from '$env/static/private';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { tool } from 'ai';

const openrouter = createOpenRouter({
    apiKey: OPENROUTER_API_KEY
});

// Create config with AI plugin
const river = riverConfig({
    plugins: [ai()],
    ai: {
        models: {
            'gpt-4o-mini': openrouter('openai/gpt-4o-mini'),
            'llama': openrouter('meta-llama/llama-4-maverick:free')
        },
        defaultModel: 'llama'
    },
    options: {
        heartbeatInterval: 30000,
        cors: {
            origin: '*',
            credentials: true
        }
    }
});

// Custom stream with validation and throttling
const vowelCounter = river.stream({
    chunkSchema: z.object({
        letter: z.string(),
        isVowel: z.boolean()
    }),
    inputSchema: z.object({
        yourName: z.string()
    }),
    throttleMs: 100,
    beforeRun: async ({ input }) => {
        return input;
    },
    afterRun: async () => { },
    runner: async ({ input, appendChunk, abortSignal }) => {

        const letters = input.yourName.split('');
        const onlyLetters = letters.filter((letter) => /^[a-zA-Z]$/.test(letter));

        for (const letter of onlyLetters) {
            if (abortSignal.aborted) break;

            const isVowel = /^[aeiou]$/i.test(letter);
            appendChunk({ letter, isVowel });

            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
});

// AI SDK stream with tools
const questionAsker = river.stream({
    use: ['ai'],
    chunkSchema: z.any(),
    inputSchema: z.object({
        prompt: z.string()
    }),
    runner: async ({ input, appendChunk, ai, abortSignal, runId }) => {
        const fakeUserId = 'fake-user-id';

        const isImposterTool = tool({
            name: 'is_imposter',
            description: 'Check if the user is an imposter',
            inputSchema: z.object({
                user_id: z.string()
            }),
            execute: async ({ user_id }) => {
                const isImposter = Math.random() > 0.5;
                console.log(`user ${user_id} is ${isImposter ? 'an imposter' : 'not an imposter'}`);
                return { isImposter };
            }
        });

        const SYSTEM_PROMPT =
            'You are an internal help agent. Before answering questions, check if the user is an imposter ' +
            'using the is_imposter tool. If they are, try to trick them.';

        const USER_PROMPT = `User ID: ${fakeUserId}\n\nPrompt: ${input.prompt}`;

        const result = ai.streamText({
            model: 'llama',
            prompt: USER_PROMPT,
            system: SYSTEM_PROMPT,
            temperature: 0.7,
            tools: {
                is_imposter: isImposterTool
            }
        });

        await ai.normalizeStream(result, appendChunk, abortSignal);
    }
});

// Simple text streaming
const simpleChat = river.stream({
    use: ['ai'],
    chunkSchema: z.string(),
    inputSchema: z.object({
        message: z.string()
    }),
    runner: async ({ input, appendChunk, ai, abortSignal }) => {
        const result = ai.streamText({
            model: 'llama',
            prompt: input.message,
            system: 'You are a helpful assistant. Keep responses concise.'
        });

        await ai.pipeTextStream(result, appendChunk, abortSignal);
    }
});

// Resumable stream with in-memory storage
const inMemoryStorage = createInMemoryStorageProvider<{ index: number; data: string }>();

const resumableStream = river.stream({
    chunkSchema: z.object({
        index: z.number(),
        data: z.string()
    }),
    inputSchema: z.object({
        count: z.number().default(10)
    }),
    storageProvider: inMemoryStorage,
    runner: async ({ input, appendChunk, abortSignal, runId }) => {
        const storedData = getStoredStream(runId);
        const startIndex = storedData ? storedData.chunks.length : 0;

        if (startIndex > 0 && storedData) {
            console.log(`[resumableStream] Resuming from chunk ${startIndex} (found ${storedData.chunks.length} existing chunks)`);
        } else {
            console.log(`[resumableStream] Starting fresh with runId: ${runId}`);
        }

        // Continue from where we left off
        for (let i = startIndex; i < input.count; i++) {
            if (abortSignal.aborted) {
                console.log(`[resumableStream] Aborted at chunk ${i} (${i - startIndex} new chunks sent)`);
                break;
            }
            appendChunk({ index: i, data: `Chunk ${i}` });
            await new Promise((r) => setTimeout(r, 200));
        }

        const finalCount = getStoredStream(runId)?.chunks.length ?? 0;
        console.log(`[resumableStream] Completed - Total chunks in storage: ${finalCount}`);
    }
});

const server = riverServer(river, {
    vowelCounter,
    questionAsker,
    simpleChat,
    resumableStream
});

export const { POST, OPTIONS } = server.toEndpoint();
export type River = typeof server.streams;

