import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";

/**
 * The pins of a job key (#Q3995): a framework API key minted for one host
 * job, and what bounds it beyond its owner's rank.
 *
 * The key itself is an `api_keys` row (`apiKeyId`, a logical reference):
 * its token is `ak_lorejob_...`, owned by the member who started the job, and
 * it expires after the job's timeout plus a margin. This row says what it
 * may reach:
 *
 * - **one project**, `projectId`: an MCP call resolving any other is refused;
 * - optionally **one quest**, **one feedback item** or **one epic**, by
 *   per-project number: an MCP call naming another is refused.
 *
 * The key reaches Lore's MCP only, and any tool its owner's rank allows
 * within those pins (#Q4222). Every check is server side (`JobKeyService`),
 * never the prompt's. `revokedAt` is set on every terminal job status; the api
 * key is revoked with it.
 */
export const jobKeys = $entity({
  name: "job_keys",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    apiKeyId: z.uuid(),
    jobId: z.uuid(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    userId: z.uuid(),
    questNumber: z.integer().optional(),
    feedbackNumber: z.integer().optional(),
    // The global triage's set of items (#Q4183); a key holds this or
    // `feedbackNumber`, never both.
    feedbackNumbers: z.array(z.integer()).max(50).optional(),
    // An epic review's epic (#Q4214): its `epic_*` tools reach this number
    // only, its creates file under it, its quest writes touch its quests.
    epicNumber: z.integer().optional(),
    expiresAt: z.string(),
    revokedAt: z.string().optional(),
  }),
  indexes: [{ columns: ["apiKeyId"], unique: true }, { columns: ["jobId"] }],
});

export type JobKey = Infer<typeof jobKeys.schema>;
