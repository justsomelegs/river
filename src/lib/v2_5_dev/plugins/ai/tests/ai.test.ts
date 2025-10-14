import { describe, expect, it, vi } from 'vitest';

vi.mock('ai', () => {
	const streamText = vi.fn(async ({ model }: { model: { stream: () => Promise<any> } }) =>
		model.stream()
	);
	return { streamText };
});

import { ai } from '../index.js';
import type { AIHelpers, AIPluginConfig } from '../types.js';

const createMeta = () =>
	({
		event: {
			request: new Request('https://example.com'),
			url: new URL('https://example.com')
		}
	}) as any;

const createHelpers = (config: AIPluginConfig): AIHelpers => {
	const descriptor = ai();
	const plugin = descriptor.createPlugin(config)({
		getStream: () => undefined
	});

	const context = plugin.extendRunnerContext?.(createMeta());
	if (!context?.ai) {
		throw new Error('AI helpers were not provided by plugin');
	}

	return context.ai;
};

describe('AI plugin', () => {
	it('validates defaultModel presence', () => {
		const descriptor = ai();

		expect(() =>
			descriptor.createPlugin({
				models: {
					existing: {
						stream: async () => ({
							textStream: (async function* () {})(),
							fullStream: (async function* () {})()
						})
					} as any
				},
				defaultModel: 'missing'
			})
		).toThrowError(/defaultModel "missing" not found/);
	});

	it('falls back to default model when streamText is called without model', async () => {
		const helpers = createHelpers({
			models: {
				mock: {
					stream: async () => ({
						textStream: (async function* () {
							yield 'delta';
						})(),
						fullStream: (async function* () {})()
					})
				} as any
			},
			defaultModel: 'mock'
		});

		const chunks: string[] = [];
		await helpers.pipeTextStream(
			await helpers.streamText({
				prompt: 'hello world'
			} as any),
			(chunk) => chunks.push(chunk),
			new AbortController().signal
		);

		expect(chunks).toEqual(['delta']);
	});

	it('normalizes tool call events', async () => {
		const helpers = createHelpers({
			models: {
				mock: {
					stream: async () => ({
						textStream: (async function* () {})(),
						fullStream: (async function* () {
							yield {
								type: 'tool-call',
								toolName: 'demo',
								input: { foo: 'bar' },
								dynamic: false
							};
							yield {
								type: 'tool-result',
								toolName: 'demo',
								input: { foo: 'bar' },
								output: { baz: 1 },
								dynamic: false
							};
						})()
					})
				} as any
			},
			defaultModel: 'mock'
		});

		const emitted: unknown[] = [];
		await helpers.normalizeStream(
			await helpers.streamText({} as any),
			(chunk) => emitted.push(chunk),
			new AbortController().signal
		);

		expect(emitted).toEqual([
			{
				type: 'tool-call',
				toolName: 'demo',
				input: { foo: 'bar' },
				dynamic: false
			},
			{
				type: 'tool',
				toolName: 'demo',
				input: { foo: 'bar' }
			},
			{
				type: 'tool-result',
				toolName: 'demo',
				input: { foo: 'bar' },
				output: { baz: 1 },
				dynamic: false
			},
			{
				type: 'tool',
				toolName: 'demo',
				input: { foo: 'bar' },
				output: { baz: 1 }
			}
		]);
	});
});
