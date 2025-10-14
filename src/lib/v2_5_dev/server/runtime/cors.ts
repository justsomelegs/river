import type { RiverServerConfig as RiverServerOptions } from '../../types.js';

let warnedWildcardWithCredentials = false;

export function buildCorsHeaders(
	options: RiverServerOptions | undefined,
	requestOrigin: string | null
): Record<string, string> {
	const headers: Record<string, string> = {};

	if (!options?.cors || !requestOrigin) {
		return headers;
	}

	const { origin, credentials } = options.cors;

	let allowed = false;
	if (typeof origin === 'string') {
		allowed = origin === '*' || origin === requestOrigin;
	} else if (Array.isArray(origin)) {
		allowed = origin.includes(requestOrigin);
	} else if (typeof origin === 'function') {
		try {
			allowed = origin(requestOrigin);
		} catch (error) {
			console.error('Failed to evaluate CORS origin callback:', error);
		}
	}

	if (!allowed) {
		return headers;
	}

	if (origin === '*' && credentials && !warnedWildcardWithCredentials) {
		console.warn(
			'River CORS: `origin: "*"` cannot be used with credentials. Falling back to echoing the request origin.'
		);
		warnedWildcardWithCredentials = true;
	}

	headers['Access-Control-Allow-Origin'] = origin === '*' && !credentials ? '*' : requestOrigin;
	if (credentials) {
		headers['Access-Control-Allow-Credentials'] = 'true';
	}

	return headers;
}
