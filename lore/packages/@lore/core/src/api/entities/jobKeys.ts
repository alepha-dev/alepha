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
 * - optionally **one quest** and **one feedback item**, by per-project
 *   number: an MCP call naming another is refused;
 * - **an allowlist of MCP tools**, `tools`: any other tool is refused;
 * - **git read on one repository**, `repositoryId`, and **write only to
 *   `refs/heads/<writeRefPrefix>` and below** when a prefix is set.
 *
 * Every check is server side (`JobKeyService`, Build's git access), never
 * the prompt's. `revokedAt` is set on every terminal job status; the api
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
    tools: z.array(z.string().max(100)).max(64),
    questNumber: z.integer().optional(),
    feedbackNumber: z.integer().optional(),
    // The global triage's set of items (#Q4183); a key holds this or
    // `feedbackNumber`, never both.
    feedbackNumbers: z.array(z.integer()).max(50).optional(),
    repositoryId: z.string().max(64).optional(),
    writeRefPrefix: z.string().max(200).optional(),
    expiresAt: z.string(),
    revokedAt: z.string().optional(),
  }),
  indexes: [{ columns: ["apiKeyId"], unique: true }, { columns: ["jobId"] }],
});

export type JobKey = Infer<typeof jobKeys.schema>;
