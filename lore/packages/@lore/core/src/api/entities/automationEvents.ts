import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";

/**
 * ⚠️ Kept until #Q3902 drops the table: nothing reads or writes it since
 * #Q3896 deleted the automation engine. Its columns keep their storage
 * shape, so no migration is generated before the drop.
 */
export const automationEvents = $entity({
  name: "automation_events",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    identity: z.string().min(1).max(255),
    name: z
      .enum([
        "feedback.created",
        "release.published",
        "epic.completed",
        "quest.completed",
        "deploy.failed",
        "deploy.succeeded",
        "monitor.down",
        "monitor.up",
        "host.credential_invalid",
        "host.expired",
        "host.offline",
        "host.online",
      ])
      .meta({ mode: "text" }),
    occurredAt: z.datetime(),
    replayUntil: z.datetime(),
    payload: z.record(z.string(), z.any()),
    cursor: z.string().max(255).optional(),
    attempts: db.default(z.integer().nonnegative(), 0),
    leaseToken: z.uuid().optional(),
    leaseUntil: z.datetime().optional(),
    dispatchedAt: z.datetime().optional(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
  }),
  indexes: [
    { columns: ["projectId", "identity"], unique: true },
    { columns: ["dispatchedAt", "attempts", "createdAt", "id"] },
    { columns: ["replayUntil", "id"] },
  ],
});

export type AutomationEvent = Infer<typeof automationEvents.schema>;
