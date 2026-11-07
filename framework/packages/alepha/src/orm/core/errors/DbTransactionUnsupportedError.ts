import { z } from "alepha";

import { DbError } from "./DbError.ts";

/**
 * A `$transactional()` block on a driver that cannot honour it.
 *
 * Cloudflare D1 has no interactive transactions, so a block there would run
 * in place and roll nothing back. It is refused rather than run as a silent
 * no-op. Declare `$transactional({ allowNonAtomic: true })` to run it anyway,
 * or guard the writes instead: preconditions in the WHERE, `db.version()`,
 * or an order in which a failure leaves harmless state.
 */
export const DbTransactionUnsupportedError = DbError.extend({
  name: "DB_TRANSACTION_UNSUPPORTED",
  default: { status: 500 },
  schema: z.object({ driver: z.text() }),
  message: (data) =>
    `$transactional() refused: the ${data.driver} driver has no transactions, so a failure would roll nothing back. Guard the writes instead (a WHERE precondition, db.version(), a safe write order), or declare $transactional({ allowNonAtomic: true }) to run the block without atomicity.`,
});

export type DbTransactionUnsupportedError = InstanceType<
  typeof DbTransactionUnsupportedError
>;
