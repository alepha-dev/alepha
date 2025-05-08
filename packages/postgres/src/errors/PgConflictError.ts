export class PgConflictError extends Error {
	readonly code = "ERR_RESOURCE_EXISTS";
	readonly status = 409;
	constructor(
		message: string,
		public readonly cause: Error,
	) {
		super(message);
		this.name = "DuplicateError";
	}
}
