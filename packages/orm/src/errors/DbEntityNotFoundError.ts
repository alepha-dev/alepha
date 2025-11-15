import { DbError } from "./DbError.ts";

export class DbEntityNotFoundError extends DbError {
  readonly name = "DbEntityNotFoundError";
  readonly status = 404;

  constructor(entityName: string) {
    super(`Entity from '${entityName}' was not found`);
  }
}
