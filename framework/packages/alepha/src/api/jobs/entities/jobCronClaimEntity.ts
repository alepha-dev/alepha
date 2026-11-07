import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * One row per cron tick a replica claimed: the job's name and the instant
 * the tick was SCHEDULED for, which every replica derives from the same
 * expression whatever its wall clock says.
 *
 * The primary key is the claim. Every replica inserts the same `id` for the
 * same tick, the database keeps the first, and the others get a conflict and
 * stand down. That is what makes a tick run once across self-hosted replicas
 * with nothing but the database `$job` already requires: no Redis. On
 * Cloudflare a Cron Trigger fires once per schedule, so the insert never
 * conflicts there.
 *
 * Rows are only ever inserted and trimmed: the hourly trim deletes claims
 * older than a day, long past any tick that could still race for them.
 */
export const jobCronClaimEntity = $entity({
  name: "job_cron_claims",
  schema: z.object({
    /**
     * `<jobName>@<instant ISO>`.
     */
    id: db.primaryKey(z.text()),
    jobName: z.text(),
    instant: z.datetime(),
    createdAt: db.createdAt(),
  }),
});

export type JobCronClaimEntity = Infer<typeof jobCronClaimEntity.schema>;
