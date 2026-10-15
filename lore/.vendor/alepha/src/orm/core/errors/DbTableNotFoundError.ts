import { z } from "alepha";

import { DbError } from "./DbError.ts";

/**
 * A statement against a table that does not exist: usually a migration not
 * run.
 */
export const DbTableNotFoundError = DbError.extend({
  name: "DB_TABLE_NOT_FOUND",
  schema: z.object({ table: z.text().optional() }),
  message: (data) =>
    data.table
      ? `Table '${data.table}' does not exist. Have you run migrations?`
      : "Table does not exist. Have you run migrations?",
});

export type DbTableNotFoundError = InstanceType<typeof DbTableNotFoundError>;
