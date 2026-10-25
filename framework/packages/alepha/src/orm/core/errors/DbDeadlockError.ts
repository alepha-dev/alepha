import { z } from "alepha";

import { DbError } from "./DbError.ts";

/**
 * A transaction aborted by a deadlock; retrying it usually succeeds.
 */
export const DbDeadlockError = DbError.extend({
  name: "DB_DEADLOCK",
  default: { status: 409, retryable: true },
  schema: z.object({ retryable: z.boolean() }),
  message: "Transaction deadlock detected. Please retry the operation.",
});

export type DbDeadlockError = InstanceType<typeof DbDeadlockError>;
