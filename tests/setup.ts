import { afterEach, beforeEach, vi } from 'vitest';

if (!globalThis.fetch) {
	globalThis.fetch = vi.fn(async () => {
		throw new Error('Fetch not implemented for tests. Provide a mock within your test.');
	}) as unknown as typeof fetch;
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});
