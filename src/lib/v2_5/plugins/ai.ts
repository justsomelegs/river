import type { RiverPlugin } from '../types.js';

export function AI(): RiverPlugin {
	return () => ({
		name: 'ai',
		wrapRunner: (next) => async (args) => {
			const start = Date.now();
			try {
				await next(args);
			} finally {
				const duration = Date.now() - start;
				console.log('ai', { duration });
			}
		}
	});
}
