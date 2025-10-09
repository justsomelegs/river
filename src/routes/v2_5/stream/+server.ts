import { riverServer, ai } from '$lib/v2_5_dev/index.js';
import { openrouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';

const server = riverServer({
	plugins: [
		ai({
			models: {
				'gpt-4o-mini': openrouter('openai/gpt-4o-mini'),
				'claude-3.5-sonnet': openrouter('anthropic/claude-3.5-sonnet')
			},
			defaultModel: 'gpt-4o-mini'
		})
	],

	streams: (stream) => ({
		aiChat: stream({
			use: ['ai'],
			chunkSchema: z.object({
				delta: z.string()
			}),
			inputSchema: z.object({
				query: z.string(),
				model: z.enum(['gpt-4o-mini', 'claude-3.5-sonnet']).default('gpt-4o-mini'),
				system: z.string().optional()
			}),
			runner: async ({ input, appendChunk, ai, abortSignal }) => {
				const result = ai.streamText({
					model: input.model,
					prompt: input.query,
					system: input.system || 'You are a helpful assistant.',
					temperature: 0.7
				});

				await ai.pipeTextStream(
					result,
					(delta) => {
						appendChunk({ delta });
					},
					abortSignal
				);
			}
		}),
		notifications: stream({
			chunkSchema: z.object({
				type: z.literal('note'),
				text: z.string(),
				i: z.number()
			}),
			runner: async ({ appendChunk, abortSignal }) => {
				let i = 0;

				while (!abortSignal.aborted && i < 10) {
					appendChunk({ type: 'note', text: `Notification ${i}`, i });
					await new Promise((r) => setTimeout(r, 500));
					i++;
				}
			}
		})
	})
});

export const POST = server.toEndpoint().POST;
export const OPTIONS = server.toEndpoint().OPTIONS;
