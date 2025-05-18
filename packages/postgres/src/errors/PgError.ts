export class PgError extends Error {
	readonly cause?: Error;

	constructor(message: string, cause?: Error) {
		super(message);
		this.cause = cause;
		this.name = "PgError";
	}
}
