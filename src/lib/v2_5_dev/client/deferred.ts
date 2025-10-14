export interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason?: unknown) => void;
	settled: boolean;
}

export function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	let settled = false;

	const promise = new Promise<T>((res, rej) => {
		resolve = (value) => {
			settled = true;
			res(value);
		};
		reject = (reason) => {
			settled = true;
			rej(reason);
		};
	});

	return {
		promise,
		resolve,
		reject,
		get settled() {
			return settled;
		}
	};
}
