import { AlephaError } from "@alepha/core";

export class PgError extends AlephaError {
	readonly name = "PgError";

	constructor(message: string, cause?: Error) {
		super(message, { cause });
	}
}
