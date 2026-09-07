import { z } from "alepha";

import { APP_NAME_MAX_LENGTH } from "../../api/schemas/appNameSchema.ts";
import { releaseTagSchema } from "../../api/schemas/releaseTagSchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

/**
 * The pair that names a deployed copy, as `app_instance_*` already spells it.
 *
 * Restated here rather than imported from `appInstanceSchemas.ts` because the
 * DESCRIPTIONS differ: there the pair names a row to read or edit, here it
 * names where code is about to run. The bound is imported either way, so the
 * two cannot promise different lengths.
 */
const nameSchema = z.string().min(1).max(APP_NAME_MAX_LENGTH);

const instanceParamsSchema = projectParamsSchema.extend({
  app: nameSchema.describe(
    "Which app to deploy. One of the names `app_instance_list` returns, never a new one: there is no app entity, so a typo is silently a different app with no deployed copy and no estate.",
  ),
  env: nameSchema.describe(
    "Which copy of it. `app_instance_list` returns the pairs that exist; a pair with no row is refused rather than created.",
  ),
});

/**
 * One deploy run, as an agent sees it.
 *
 * ⚠️ No sealed value, no credential and no estate id. What an agent may learn
 * about a run is what shipped, how it went and what the run itself said.
 */
const deploymentSchema = z.object({
  id: z.uuid(),
  app: z.string(),
  tag: z.string(),
  sha256: z.string(),
  status: z
    .string()
    .describe(
      "`queued` while it waits, `running` from the first side effect, then `succeeded`, `failed` or `cancelled`. Only the last three are terminal; poll `deploy_status` while it is one of the first two.",
    ),
  url: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.string(),
});

// -----------------------------------------------------------------------------
// deploy_start
// -----------------------------------------------------------------------------

export const deployStartParamsSchema = instanceParamsSchema.extend({
  tag: releaseTagSchema
    .optional()
    .describe(
      "Which stored build to ship. ⚠️ Omitted, this deploys `latest`, which is the ONE tag whose bytes may be replaced in place - so `latest` today and `latest` yesterday can be different code, and deploying it promotes whatever was pushed last rather than a version anybody chose. Name a real tag to ship a build somebody tested. Nothing here builds: a tag with no stored artifact is refused, never built.",
    ),
});

export const deployStartResultSchema = z.object({
  id: z.uuid().describe("Pass this to `deploy_status` to follow the run."),
  status: z.string(),
});

// -----------------------------------------------------------------------------
// deploy_status
// -----------------------------------------------------------------------------

export const deployStatusParamsSchema = projectParamsSchema.extend({
  deployment: z
    .uuid()
    .describe("The run's id, as `deploy_start` answered it.")
    .optional(),
  app: nameSchema
    .describe(
      "Instead of a run id: the app whose copy to read the newest run of.",
    )
    .optional(),
  env: nameSchema
    .describe("Instead of a run id: which copy of that app.")
    .optional(),
});

export const deployStatusResultSchema = deploymentSchema.extend({
  log: z
    .array(z.string())
    .describe(
      "The tail of the run's log, oldest first. Bounded server-side, so a runaway deploy cannot make this unbounded, and never carrying a secret: the set a deploy ships is opened and uploaded without passing through here.",
    ),
});

// -----------------------------------------------------------------------------
// deploy_rollback
// -----------------------------------------------------------------------------

export const deployRollbackParamsSchema = projectParamsSchema.extend({
  deployment: z
    .uuid()
    .describe(
      "The successful run to go back to. `deploy_status` on the copy lists what has run here.",
    ),
  acknowledge_migrations: z
    .boolean()
    .optional()
    .describe(
      "⚠️ Required when migrations have been applied since that run shipped. A rollback changes the CODE and not the database, so the old build would run against the current schema. Call once without it: the refusal names how many, which is what you need to decide.",
    ),
});

export const deployRollbackResultSchema = z.object({
  path: z
    .string()
    .describe(
      "`version` when Cloudflare still held the bytes, which is seconds and uploads nothing; `artifact` when it did not and the stored build had to go up again.",
    ),
  reason: z
    .string()
    .optional()
    .describe("Why the fast path was unavailable, when it was."),
});
