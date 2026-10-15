import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { automationRuleSchema } from "../schemas/automationRuleSchema.ts";
import { automationSafeFieldsSchema } from "../schemas/automationSafeFieldsSchema.ts";
import { projects } from "./projects.ts";
import { users } from "./users.ts";

/**
 * A stored program always belongs to its original author. Soft deletion hides
 * configuration while preserving run evidence and the restrictive author FK.
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
    title: z.string().min(1).max(255),
    enabled: db.default(z.boolean(), false),
    health: db.default(
      z.enum(["active", "paused", "broken"]).meta({ mode: "text" }),
      "active",
    ),
    reason: z.string().max(1024).optional(),
    requiresApproval: db.default(z.boolean(), false),
    rule: automationRuleSchema,
    // Configuration revision is independent of scheduler/baseline writes.
    // The ORM version protects all row updates, including runtime bookkeeping.
    revision: db.default(z.integer().nonnegative(), 0),
    version: db.version(),
    presetKey: z.string().max(128).optional(),
    nextRunAt: z.datetime().optional(),
    scheduleCron: z.string().max(128).optional(),
    baseline: automationSafeFieldsSchema.optional(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    deletedAt: db.deletedAt(),
  }),
  indexes: [
    { columns: ["enabled", "health", "nextRunAt", "id"] },
    { columns: ["projectId", "authorUserId"] },
    { columns: ["authorUserId"] },
  ],
});

export type Automation = Infer<typeof automations.schema>;
