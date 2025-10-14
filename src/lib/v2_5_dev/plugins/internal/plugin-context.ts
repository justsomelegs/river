import type { BaseStreamContext } from '../../types.js';
import type { ContextBuilderMap, InferContextFromBuilders } from './types.js';

export function defineContext<T extends ContextBuilderMap>(builders: T) {
	return {
		create(meta: BaseStreamContext) {
			const entries = Object.entries(builders).map(([key, builder]) => [key, builder(meta)]);

			return Object.fromEntries(entries) as InferContextFromBuilders<T>;
		}
	};
}
