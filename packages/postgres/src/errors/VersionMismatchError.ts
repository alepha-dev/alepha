export class VersionMismatchError extends Error {
	constructor(table: string, id: any) {
		super(
			`Version mismatch for table '${table}' and id '${id}' - the record was updated by another transaction`,
		);
	}
}
