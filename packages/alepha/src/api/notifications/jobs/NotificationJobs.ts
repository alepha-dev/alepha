import { $inject, z } from "alepha";
import { $job, jobExecutionEntity } from "alepha/api/jobs";
import { $parameter } from "alepha/api/parameters";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { notificationPayloadSchema } from "../schemas/notificationPayloadSchema.ts";
import { NotificationSenderService } from "../services/NotificationSenderService.ts";

/**
 * Notification jobs + runtime-editable retention.
 *
 * - `settings` — a `$parameter` exposing `retentionDays` that admins can
 *   update at runtime. Changes propagate across instances via the parameter
 *   pub/sub; the next purge run picks up the new value with no restart.
 * - `sendNotification` — queue-mode, audit-oriented. Every execution is kept
 *   (`record: "all"`, `keep: { ok: 0, error: 0 }` disables the ring-buffer
 *   trim) so the audit trail survives even under heavy volume.
 * - `purgeOldNotifications` — cron sweep that deletes notification execution
 *   rows whose `completedAt` is older than the current `retentionDays`.
 *
 * Cron expression note: the purge cron is declared statically (`0 3 * * *`)
 * because some runtimes (Cloudflare Workers) freeze cron triggers at deploy
 * time. The *retention window* is fully runtime-editable — that's the knob
 * that actually matters for operators.
 */
export class NotificationJobs {
  protected readonly log = $logger();
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly notificationSenderService = $inject(
    NotificationSenderService,
  );
  protected readonly executions = $repository(jobExecutionEntity);

  /** Runtime-editable config. Admins can change retentionDays without deploy. */
  public readonly settings = $parameter({
    name: "alepha.api.notifications",
    description: "Notification delivery & retention settings.",
    schema: z.object({
      retentionDays: z
        .integer()
        .min(1)
        .describe(
          "Days to keep notification execution rows before the purge sweep removes them.",
        ),
    }),
    default: {
      retentionDays: 7,
    },
  });

  public readonly sendNotification = $job({
    name: "api:notifications:sendNotification",
    description:
      "Sends a notification (email/SMS) and keeps every execution for audit.",
    schema: notificationPayloadSchema,
    retry: {
      retries: 3,
    },
    timeout: [30, "seconds"],
    record: "all",
    keep: { ok: 0, error: 0 },
    handler: async ({ payload }) => {
      await this.notificationSenderService.send(payload);
    },
  });

  public readonly purgeOldNotifications = $job({
    name: "api:notifications:purgeOldNotifications",
    description:
      "Hourly sweep that deletes notification execution rows older than the configured retention window.",
    cron: "0 * * * *",
    handler: async ({ now }) => {
      const { retentionDays } = this.settings.cachedCurrentContent;
      const cutoff = now.subtract(retentionDays, "day").toISOString();
      const jobName = this.sendNotification.name;

      const expired = await this.executions.findMany({
        where: {
          jobName: { eq: jobName },
          status: { inArray: ["ok", "error", "cancelled"] },
          completedAt: { lt: cutoff },
        },
        columns: ["id"] as any,
        limit: 5_000,
      });

      if (expired.length === 0) {
        this.log.debug("Notification purge: nothing to delete", {
          cutoff,
          retentionDays,
        });
        return;
      }

      await this.executions.deleteMany({
        id: { inArray: expired.map((r) => r.id) },
      });
      this.log.info(
        `Notification purge: deleted ${expired.length} row(s) older than ${retentionDays} days`,
        { cutoff },
      );
    },
  });
}
