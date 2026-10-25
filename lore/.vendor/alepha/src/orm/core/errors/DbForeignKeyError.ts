import { z } from "alepha";

import { DbError } from "./DbError.ts";

/**
 * A write referencing a missing row, or a delete of a row still referenced.
 */
export const DbForeignKeyError = DbError.extend({
  name: "DB_FOREIGN_KEY",
  default: { status: 409 },
  schema: z.object({
    referencingTable: z.text().optional(),
    constraintName: z.text().optional(),
  }),
  message: "Foreign key constraint failed",
});

export type DbForeignKeyError = InstanceType<typeof DbForeignKeyError>;
