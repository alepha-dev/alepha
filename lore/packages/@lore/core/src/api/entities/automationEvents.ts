import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { automationEventPayloadSchema } from "../schemas/automationEventPayloadSchema.ts";
import { projects } from "./projects.ts";

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
      ])
      .meta({ mode: "text" }),
    occurredAt: z.datetime(),
    replayUntil: z.datetime(),
    payload: automationEventPayloadSchema,
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
