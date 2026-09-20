import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * One row per analytics dataset that has been backfilled, ever (#E65).
 *
 * ## Why a table for one row
 *
 * Analytics Engine has **no delete API**. Pruning is a read-time floor, not a
 * deletion, so a backfill that runs twice cannot be repaired: the second pass
 * adds to what the first wrote rather than replacing it, and every bar on
 * Home reads double from then on, permanently. The guard therefore has to be
 * durable, has to be checked before the first write, and has to survive a
 * redeploy - which rules out anything in memory and anything in the dataset
 * itself, since a dataset cannot be read back reliably the instant after it
 * is written.
 *
 * One `CREATE TABLE` with no foreign key is also the cheapest thing that can
 * be true on D1: no parent, no cascade, nothing for a future rebuild to wipe.
 *
 * ## It is also the receipt
 *
 * The row records what the pass actually did, so "did the backfill run, and
 * did it write what the audit log said it should" is a `SELECT` rather than
 * an inference from the bars. That is the only proof available after the
 * fact, because the dataset it wrote into cannot be diffed against anything.
 */
export const analyticsBackfills = $entity({
  name: "analytics_backfills",
  schema: z.object({
    /**
     * The dataset name, as `$analytics` declares it - `project_activity`.
     *
     * The primary key, so a second pass over the same dataset cannot insert
     * even if two isolates reach the check at the same moment: the unique
     * constraint refuses the second write rather than leaving the race to be
     * won by whoever is faster.
     */
    dataset: db.primaryKey(z.text()),
    createdAt: db.createdAt(),
    /**
     * The oldest hour bucket the pass considered, `YYYY-MM-DDTHH`.
     */
    windowFrom: z.text(),
    /**
     * The newest hour bucket the pass considered, `YYYY-MM-DDTHH`.
     */
    windowTo: z.text(),
    /**
     * How many distinct `(project, type, action, actor, hour)` tuples were
     * written.
     */
    points: z.integer(),
    /**
     * How many audit events those tuples stand for - the `SUM(event_count)`
     * of the window, minus whatever the skipped hours held.
     *
     * This is the number to compare against the same query over `audits`.
     */
    events: z.integer(),
    /**
     * How many hour buckets were skipped because the dataset already held
     * points for them.
     *
     * Never zero in practice: live recording starts the moment the code
     * deploys, and the backfill runs some time after, so every hour between
     * the deploy and this pass is already recorded. See
     * `ActivityBackfillJob` for why the hour the deploy landed in is
     * knowingly under-counted rather than double-counted.
     */
    skippedHours: z.integer(),
  }),
});

export type AnalyticsBackfill = Infer<typeof analyticsBackfills.schema>;
