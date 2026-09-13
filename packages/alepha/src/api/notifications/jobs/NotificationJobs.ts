import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

import { notificationPayloadSchema } from "../schemas/notificationPayloadSchema.ts";
import { NotificationDeliveryService } from "../services/NotificationDeliveryService.ts";
import { NotificationInboxService } from "../services/NotificationInboxService.ts";
import { NotificationSenderService } from "../services/NotificationSenderService.ts";
import { NotificationSettings } from "../services/NotificationSettings.ts";

/**
 * Notification jobs + runtime-editable retention.
 *
 * - `settings` - the `$parameter` from {@link NotificationSettings}, holding
 *   the retention windows and the stored-body switch. Admins change them at
 *   runtime; the values propagate across instances via the parameter pub/sub
 *   and the next trim or purge picks them up with no restart.
 * - `sendNotification` - queue-mode, audit-oriented. Every execution is kept
 *   for `retentionDays`, successes and failures alike, however many there
 *   are. The job's `retention` reads the parameter through a function, so the
 *   jobs module's hourly trim applies the window an operator set, and nothing
 *   else deletes these rows.
 * - `purgeOldNotifications` - hourly sweep that deletes expired delivery
 *   receipts, then read inbox messages. Clocks of their own, on purpose: the
 *   outbox is short (7 days) and the receipts are long (90), because a
 *   complaint can arrive after the outbox row is gone; the inbox has its own
 *   because a read message is one the reader has already dealt with, and an
 *   unread one is never swept at all.
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
  protected readonly deliveries = $inject(NotificationDeliveryService);
  protected readonly inbox = $inject(NotificationInboxService);

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
    // Read at every trim tick, so an operator's edit applies without a
    // restart. Declared, so no row cap applies: a busy app legitimately sends
    // more than a thousand notifications in a week.
    retention: {
      ok: { days: () => this.settings.current.retentionDays },
      error: { days: () => this.settings.current.retentionDays },
    },
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
      "Hourly sweep that deletes delivery receipts and read inbox messages older than their retention windows.",
    cron: "0 * * * *",
    handler: async ({ now }) => {
      const { receiptRetentionDays, inboxRetentionDays } =
        this.settings.current;

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

      // Its own clock, and the only one that looks at read state. An unread
      // message is never swept: it waited for you, which is the feature.
      const staleInbox = await this.inbox.purge(
        now.subtract(inboxRetentionDays, "day").toISOString(),
      );
      if (staleInbox > 0) {
        this.log.info(
          `Notification purge: deleted ${staleInbox} read inbox message(s) older than ${inboxRetentionDays} days`,
        );
      }
    },
  });
}
