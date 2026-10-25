import { z } from "alepha";

export const automationTriggerSchema = z.union([
  z
    .object({
      kind: z.literal("event"),
      event: z.enum([
        "feedback.created",
        "release.published",
        "epic.completed",
        "deploy.failed",
        "deploy.succeeded",
        "quest.completed",
      ]),
      app: z.string().max(255).optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal("schedule"), cron: z.string().min(9).max(128) })
    .strict(),
]);
