import { DbError } from "./DbError.ts";

/**
 * A write refused by a unique constraint.
 */
export const DbConflictError = DbError.extend({
  name: "DB_CONFLICT",
  default: { status: 409 },
  message: "Entity already exists",
});

export type DbConflictError = InstanceType<typeof DbConflictError>;
