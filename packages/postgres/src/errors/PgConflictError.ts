export class PgConflictError extends Error {
	readonly error = "ConflictError";
	readonly status = 409;
	readonly cause: Error;

	constructor(message: string, cause: Error) {
		super(message);
		this.cause = cause;
		this.name = "DuplicateError";
	}
}
