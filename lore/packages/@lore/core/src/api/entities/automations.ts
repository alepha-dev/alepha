import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";
import { users } from "./users.ts";

/**
 * A stored program always belongs to its original author. Soft deletion hides
 * configuration while preserving run evidence and the restrictive author FK.
 */
/**
 * ⚠️ Kept until #Q3902 drops the table: nothing reads or writes it since
 * #Q3896 deleted the automation engine. Its columns keep their storage
 * shape, so no migration is generated before the drop.
 */
export const automations = $entity({
  name: "automations",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    authorUserId: db.ref(z.uuid(), () => users.cols.id, {
      onDelete: "restrict",
    }),
    authorKeyId: z.uuid().optional(),
    authorSessionId: z.uuid().optional(),
    authorScope: z.array(z.string().max(128)).max(512).optional(),
    approvedVariables: db.default(
      z.array(z.record(z.string(), z.any())).max(64),
      [],
    ),
    activatedAt: z.datetime().optional(),
    title: z.string().min(1).max(255),
    enabled: db.default(z.boolean(), false),
    health: db.default(
      z.enum(["active", "paused", "broken"]).meta({ mode: "text" }),
      "active",
    ),
    reason: z.string().max(1024).optional(),
    /**
     * Each source's own health (#Q3806). `health` stays what SQL fences on,
     * and is `broken` only when no enabled source can run.
     */
    sourceHealth: z.record(z.string(), z.any()).optional(),
    healthCheckedAt: db.default(z.int64().nonnegative(), 0),
    requiresApproval: db.default(z.boolean(), false),
    rule: z.record(z.string(), z.any()),
    // Configuration revision is independent of scheduler/baseline writes.
    // The ORM version protects all row updates, including runtime bookkeeping.
    revision: db.default(z.integer().nonnegative(), 0),
    version: db.version(),
    presetKey: z.string().max(128).optional(),
    /**
     * Created by a subscription toggle, such as the feedback page's bell, for
     * its author: the toggle finds its rule again by `presetKey`, the author
     * and this flag. It stays an ordinary rule, listed and editable.
     */
    subscription: db.default(z.boolean(), false),
    /**
     * The subscription's scope (#Q3635), in its canonical form: the setup
     * values its bell binds, such
     * as `monitor=<id>`. Empty for a list's bell, and for every rule that is
     * not a subscription.
     */
    subscriptionScope: db.default(z.string().max(255), ""),
    nextRunAt: z.datetime().optional(),
    scheduleCron: z.string().max(128).optional(),
    baseline: z.record(z.string(), z.any()).optional(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    deletedAt: db.deletedAt(),
  }),
  indexes: [
    { columns: ["enabled", "health", "nextRunAt", "id"] },
    { columns: ["projectId", "authorUserId"] },
    { columns: ["healthCheckedAt", "id"] },
    { columns: ["authorUserId"] },
  ],
});

export type Automation = Infer<typeof automations.schema>;
