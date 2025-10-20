import { PgError } from "./PgError.ts";

export class PgEntityNotFoundError extends PgError {
  readonly name = "EntityNotFoundError";
  readonly status = 404;

  constructor(entityName: string) {
    super(`Entity from '${entityName}' was not found`);
  }
}
