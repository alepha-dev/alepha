import { $inject } from "alepha";
import { $job, jobExecutionEntity } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { notificationPayloadSchema } from "../schemas/notificationPayloadSchema.ts";
import { NotificationDeliveryService } from "../services/NotificationDeliveryService.ts";
import { NotificationSenderService } from "../services/NotificationSenderService.ts";
import { NotificationSettings } from "../services/NotificationSettings.ts";

/**
 * Notification jobs + runtime-editable retention.
 *
 * - `settings` - the `$parameter` from {@link NotificationSettings}, holding
 *   both retention windows and the stored-body switch. Admins change them at
 *   runtime; the values propagate across instances via the parameter pub/sub
 *   and the next sweep picks them up with no restart.
 * - `sendNotification` - queue-mode, audit-oriented. Every execution is kept
 *   (`record: "all"`, `keep: { ok: 0, error: 0 }` disables the ring-buffer
 *   trim) so the audit trail survives even under heavy volume.
 * - `purgeOldNotifications` - hourly sweep that deletes expired delivery
 *   receipts and then expired notification execution rows. Two clocks, on
 *   purpose: the outbox is short (7 days) and the receipts are long (90),
 *   because a complaint can arrive after the outbox row is gone.
 *
 * Cron expression note: the purge cron is declared statically (`0 * * * *`)
 * because some runtimes (Cloudflare Workers) freeze cron triggers at deploy
 * time. The retention windows are the knob that actually matters for
 * operators, and those are runtime-editable.
 */
export class NotificationJobs {
  protected readonly log = $logger();
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly notificationSenderService = $inject(
    NotificationSenderService,
  );
  protected readonly executions = $repository(jobExecutionEntity);
  protected readonly deliveries = $inject(NotificationDeliveryService);

  /**
   * Runtime-editable config, declared in {@link NotificationSettings} so the
   * sender can read it without closing a dependency cycle through this
   * class. Kept as a field here because the parameter has to be registered
   * by something the module loads.
   */
  protected readonly settings = $inject(NotificationSettings);

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
    // `executionId` is one field further out than `payload`, and it is what
    // a delivery receipt is keyed on. Without it the sender cannot record
    // what happened.
    handler: async ({ payload, executionId }) => {
      await this.notificationSenderService.send(payload, { executionId });
    },
  });

  public readonly purgeOldNotifications = $job({
    name: "api:notifications:purgeOldNotifications",
    description:
      "Hourly sweep that deletes notification execution rows older than the configured retention window.",
    cron: "0 * * * *",
    handler: async ({ now }) => {
      const { retentionDays, receiptRetentionDays } = this.settings.current;

      // Receipts have their own, longer clock: a complaint can arrive weeks
      // after the send, by which time the outbox row is long gone.
      const purged = await this.deliveries.purge(
        now.subtract(receiptRetentionDays, "day").toISOString(),
      );
      if (purged > 0) {
        this.log.info(
          `Notification purge: deleted ${purged} receipt(s) older than ${receiptRetentionDays} days`,
        );
      }

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
