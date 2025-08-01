import { AlephaError } from "@alepha/core";

export class PgMigrationError extends AlephaError {
	readonly name = "PgMigrationError";

	constructor(message: string, cause?: unknown) {
		super(message, { cause });
	}
}
