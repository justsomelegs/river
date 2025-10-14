export class RiverClientError extends Error {
	readonly cause: unknown;

	constructor(message: string, cause?: unknown) {
		super(message);
		this.name = 'RiverClientError';
		this.cause = cause;
	}
}
