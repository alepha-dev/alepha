export class EntityNotFoundError extends Error {
	readonly code = "ERR_RESOURCE_NOTFOUND";
	readonly statusCode = 404;
	constructor(entityName: string) {
		super(`Entity ${entityName} not found`);
	}
}
