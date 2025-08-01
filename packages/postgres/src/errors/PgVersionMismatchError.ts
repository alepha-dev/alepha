import { AlephaError } from "@alepha/core";

export class PgVersionMismatchError extends AlephaError {
	readonly name = "PgVersionMismatchError";

	constructor(table: string, id: any) {
		super(
			`Version mismatch for table '${table}' and id '${id}' - the record was updated by another transaction`,
		);
	}
}
