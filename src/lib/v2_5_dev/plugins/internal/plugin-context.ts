import type { BaseStreamContext } from '../../types.js';

type BuilderMap = Record<string, (meta: BaseStreamContext) => unknown>;

type InferContext<T extends BuilderMap> = {
	[K in keyof T]: T[K] extends (meta: BaseStreamContext) => infer R ? R : never;
};

export function defineContext<T extends BuilderMap>(builders: T) {
	return {
		create(meta: BaseStreamContext) {
			const entries = Object.entries(builders).map(([key, builder]) => [key, builder(meta)]);

			return Object.fromEntries(entries) as InferContext<T>;
		}
	};
}
