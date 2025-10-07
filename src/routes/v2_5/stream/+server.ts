import { riverServer, defineStream, AI, auth } from '$lib/v2_5/index.js';
import { z } from 'zod';

const server = riverServer({
	plugins: [AI(), auth()],
	streams: {
		notifications: defineStream({
			chunkSchema: z.object({
				type: z.literal('note'),
				text: z.string(),
				i: z.number()
			}),
			runner: async ({ appendChunk, abortSignal }) => {
				let i = 0;

				// Add this to see if abort fires
				abortSignal.addEventListener('abort', () => {
					console.log('🛑 ABORT SIGNAL FIRED');
				});

				while (!abortSignal.aborted && i < 10) {
					console.log(`Processing ${i}, aborted=${abortSignal.aborted}`);
					appendChunk({ type: 'note', text: `hello ${i}`, i });
					await new Promise((r) => setTimeout(r, 500));
					i++;
				}
				console.log('✅ Runner exited');
			}
		}),

		chat: defineStream({
			chunkSchema: z.object({
				role: z.enum(['user', 'assistant']),
				content: z.string()
			}),
			inputSchema: z.object({
				query: z.string(),
				temperature: z.number().optional()
			}),
			runner: async ({ input, appendChunk, abortSignal }) => {
				appendChunk({ role: 'user', content: input.query });
				await new Promise((r) => setTimeout(r, 100));
				if (!abortSignal.aborted) {
					appendChunk({
						role: 'assistant',
						content: `Response to: ${input.query}`
					});
				}
			}
		}),

		dataFeed: defineStream({
			chunkSchema: z.discriminatedUnion('type', [
				z.object({ type: z.literal('progress'), percent: z.number() }),
				z.object({ type: z.literal('data'), value: z.any() }),
				z.object({ type: z.literal('complete'), totalItems: z.number() })
			]),
			inputSchema: z.object({
				source: z.string(),
				limit: z.number().default(100)
			}),
			runner: async ({ input, appendChunk, abortSignal }) => {
				for (let i = 0; i < input.limit && !abortSignal.aborted; i++) {
					if (i % 10 === 0) {
						appendChunk({ type: 'progress', percent: (i / input.limit) * 100 });
					}
					appendChunk({ type: 'data', value: { id: i, source: input.source } });
					await new Promise((r) => setTimeout(r, 50));
				}
				if (!abortSignal.aborted) {
					appendChunk({ type: 'complete', totalItems: input.limit });
				}
			}
		})
	}
});

export const POST = server.toEndpoint().POST;
