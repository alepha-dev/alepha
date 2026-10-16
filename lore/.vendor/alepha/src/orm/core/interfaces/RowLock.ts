/**
 * The row lock a SELECT takes (`FOR UPDATE` and its siblings).
 *
 * A bare mode waits for a conflicting lock. The object form says what to do
 * instead: `onLocked: "skip"` leaves the locked rows out (`SKIP LOCKED`, the
 * job-queue pattern), `onLocked: "nowait"` fails at once (`NOWAIT`).
 *
 * Postgres only: SQLite has no row locks and ignores it.
 */
export type RowLock =
  | RowLockMode
  | {
      mode: RowLockMode;
      onLocked: "skip" | "nowait";
    };

/**
 * The strength of a row lock, from the strongest to the weakest.
 */
export type RowLockMode = "update" | "no key update" | "share" | "key share";
