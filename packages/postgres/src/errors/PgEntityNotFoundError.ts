import { DbError } from "./DbError.ts";

export class PgEntityNotFoundError extends DbError {
  readonly name = "EntityNotFoundError";
  readonly status = 404;

  constructor(entityName: string) {
    super(`Entity from '${entityName}' was not found`);
  }
}
