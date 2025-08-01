import { AlephaError } from "@alepha/core";

export class PgEntityNotFoundError extends AlephaError {
	readonly name = "EntityNotFoundError";
	readonly status = 404;

	constructor(entityName: string) {
		super(
			`Entity from ${entityName} was not found. Please check the provided ID or query parameters.`,
		);
	}
}
