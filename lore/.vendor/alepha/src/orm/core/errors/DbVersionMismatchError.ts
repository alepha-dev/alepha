import { z } from "alepha";

import { DbError } from "./DbError.ts";

/**
 * An optimistic-locking write whose version no longer matches the row.
 */
export const DbVersionMismatchError = DbError.extend({
  name: "DB_VERSION_MISMATCH",
  default: { status: 409 },
  schema: z.object({ table: z.text(), id: z.any() }),
  message: (data) =>
    `Version mismatch for table '${data.table}' and id '${data.id}'`,
});

export type DbVersionMismatchError = InstanceType<
  typeof DbVersionMismatchError
>;
