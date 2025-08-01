import { AlephaError } from "@alepha/core";

export class PgConflictError extends AlephaError {
	readonly name = "PgConflictError";
	readonly status = 409;

	constructor(message: string, cause: unknown) {
		super(message, { cause });
	}
}
