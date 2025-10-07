import type { RiverPlugin } from '../types.js';

export function auth(): RiverPlugin {
	return (ctx) => ({
		name: 'auth',
		onInit: () => {
			ctx.addMiddleware(async ({ event }) => {
				const header = event.request.headers.get('authorization');
				if (!header) {
					return { continue: true };
				}
				if (header === 'Bearer dev-token') {
					return { continue: true };
				}
				return {
					continue: false,
					response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
				};
			});
		},
		wrapRunner: (next) => async (args) => {
			console.log('auth', { args });
			return await next(args);
		}
	});
}
