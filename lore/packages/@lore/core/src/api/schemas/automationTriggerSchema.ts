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
        "monitor.down",
        "monitor.up",
        "host.credential_invalid",
        "host.expired",
        "host.offline",
        "host.online",
      ]),
      app: z.string().max(255).optional(),
      /**
       * Only this monitor's incidents, by id (#Q3610), on `monitor.*`.
       */
      monitor: z.string().max(255).optional(),
      /**
       * Only this host's alerts, by id (#Q3627), on `host.*`.
       */
      host: z.string().max(255).optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal("schedule"), cron: z.string().min(9).max(128) })
    .strict(),
]);
