import { z } from "alepha";

import { DbError } from "./DbError.ts";

/**
 * A statement naming a column that does not exist.
 */
export const DbColumnNotFoundError = DbError.extend({
  name: "DB_COLUMN_NOT_FOUND",
  schema: z.object({ column: z.text().optional(), table: z.text().optional() }),
  message: (data) =>
    data.column
      ? data.table
        ? `Column '${data.column}' does not exist in table '${data.table}'`
        : `Column '${data.column}' does not exist`
      : "Column does not exist",
});

export type DbColumnNotFoundError = InstanceType<typeof DbColumnNotFoundError>;
