import { PgError } from "./PgError.ts";

export class PgMigrationError extends PgError {
	readonly name = "PgMigrationError";

	constructor(cause?: unknown) {
		super("Failed to migrate database", cause);
	}
}
