import { z } from "alepha";

import { DbError } from "./DbError.ts";

/**
 * A write leaving a NOT NULL column empty.
 */
export const DbNotNullError = DbError.extend({
  name: "DB_NOT_NULL",
  default: { status: 400 },
  schema: z.object({ column: z.text().optional(), table: z.text().optional() }),
  message: "A required field cannot be null",
});

export type DbNotNullError = InstanceType<typeof DbNotNullError>;
