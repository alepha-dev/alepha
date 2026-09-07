import { $module } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaApiParameters } from "alepha/api/parameters";

import { NotificationEmailChannel } from "./channels/NotificationEmailChannel.ts";
import { NotificationInboxChannel } from "./channels/NotificationInboxChannel.ts";
import { NotificationSmsChannel } from "./channels/NotificationSmsChannel.ts";
import { AdminNotificationController } from "./controllers/AdminNotificationController.ts";
import { NotificationInboxController } from "./controllers/NotificationInboxController.ts";
import { NotificationUnsubscribeController } from "./controllers/NotificationUnsubscribeController.ts";
import { NotificationWebhookController } from "./controllers/NotificationWebhookController.ts";
import { NotificationJobs } from "./jobs/NotificationJobs.ts";
import { $notification } from "./primitives/$notification.ts";
import { NotificationInboxRecipientProvider } from "./providers/NotificationInboxRecipientProvider.ts";
import { NotificationPreferenceProvider } from "./providers/NotificationPreferenceProvider.ts";
import type { NotificationDeliveryEvent } from "./schemas/notificationDeliveryEventSchema.ts";
import { NotificationAttachmentService } from "./services/NotificationAttachmentService.ts";
import { NotificationChannelService } from "./services/NotificationChannelService.ts";
import { NotificationDeliveryService } from "./services/NotificationDeliveryService.ts";
import { NotificationInboxService } from "./services/NotificationInboxService.ts";
import { NotificationIngestService } from "./services/NotificationIngestService.ts";
import { NotificationSenderService } from "./services/NotificationSenderService.ts";
import { NotificationSettings } from "./services/NotificationSettings.ts";
import { NotificationSuppressionService } from "./services/NotificationSuppressionService.ts";
import { NotificationUnsubscribeService } from "./services/NotificationUnsubscribeService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./channels/NotificationChannel.ts";
export * from "./channels/NotificationEmailChannel.ts";
export * from "./channels/NotificationInboxChannel.ts";
export * from "./channels/NotificationSmsChannel.ts";
export * from "./controllers/AdminNotificationController.ts";
export * from "./controllers/NotificationInboxController.ts";
export * from "./controllers/NotificationUnsubscribeController.ts";
export * from "./controllers/NotificationWebhookController.ts";
export * from "./entities/notificationDeliveryEntity.ts";
export * from "./entities/notificationInboxEntity.ts";
export * from "./entities/notificationSuppressionEntity.ts";
export * from "./jobs/NotificationJobs.ts";
export * from "./primitives/$notification.ts";
export * from "./providers/NotificationInboxRecipientProvider.ts";
export * from "./providers/NotificationPreferenceProvider.ts";
export * from "./schemas/notificationAttachmentSchema.ts";
export * from "./schemas/notificationContactPreferencesSchema.ts";
export * from "./schemas/notificationDeliveryEventSchema.ts";
export * from "./schemas/notificationDetailResourceSchema.ts";
export * from "./schemas/notificationInboxCountSchema.ts";
export * from "./schemas/notificationInboxPageSchema.ts";
export * from "./schemas/notificationInboxQuerySchema.ts";
export * from "./schemas/notificationInboxResourceSchema.ts";
export * from "./schemas/notificationPayloadSchema.ts";
export * from "./schemas/notificationPreviewResourceSchema.ts";
export * from "./schemas/notificationQuerySchema.ts";
export * from "./schemas/notificationResourceSchema.ts";
export * from "./schemas/notificationSuppressionResourceSchema.ts";
export * from "./schemas/notificationTemplateResourceSchema.ts";
export * from "./services/NotificationAttachmentService.ts";
export * from "./services/NotificationChannelService.ts";
export * from "./services/NotificationDeliveryService.ts";
export * from "./services/NotificationInboxService.ts";
export * from "./services/NotificationIngestService.ts";
export * from "./services/NotificationSenderService.ts";
export * from "./services/NotificationSettings.ts";
export * from "./services/NotificationSuppressionService.ts";
export * from "./services/NotificationUnsubscribeService.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha/api/notifications" {
  interface NotificationChannels<V> {
    /**
     * A message filed in the recipient's own inbox, in
     * `notification_inbox`, rather than sent anywhere.
     *
     * Declared here by declaration merging rather than inline beside `email`
     * and `sms`, because that is the mechanism a channel plugin uses and
     * this module should not have a private road its own third channel takes
     * and nobody else can.
     */
    inbox?: {
      /**
       * The one line the reader sees in the bell and in the list.
       */
      title: string | ((variables: V) => string | Promise<string>);
      /**
       * The optional second line. Plain text: a surface rendering it decides
       * how, and the framework never promises markdown.
       */
      body?: string | ((variables: V) => string | Promise<string>);
      /**
       * Where clicking the message goes. Required: a message that cannot be
       * clicked makes the reader hunt for what it is about.
       */
      href: string | ((variables: V) => string | Promise<string>);
      /**
       * The app-owned partition this message belongs to, e.g. `project:65`.
       *
       * Opaque to the framework, which stores it and compares it for
       * equality and never parses it. That is what lets one table serve a
       * scope-filtered view without the module learning what a project is.
       */
      scope?: string | ((variables: V) => string | Promise<string>);
      /**
       * What to call {@link scope} on screen, e.g. `Alepha`.
       *
       * Written by the pusher because nothing downstream can derive it: the
       * framework must not parse `scope`, and a shared component cannot
       * resolve it either, since an inbox is cross-scope by nature. Frozen at
       * send time, so a renamed project keeps the name it had when it pinged
       * you.
       */
      scopeLabel?: string | ((variables: V) => string | Promise<string>);
    };
  }
}

declare module "alepha" {
  interface Hooks {
    /**
     * A transport reported something about a message it took earlier.
     *
     * Emitted by the ingestion consumers (Cloudflare Queues events, the
     * Brevo webhook), consumed by the receipt writer and by the suppression
     * writer. Nothing in the send path emits it: a send already knows its
     * own outcome and writes the receipt directly.
     */
    "notification:delivery": NotificationDeliveryEvent;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * User notification management.
 *
 * **Features:**
 * - Notification definitions (email/SMS templates)
 * - Delivery via `$job` with retry and audit trail (`record: "all"` + no ring buffer trim)
 * - Runtime-editable retention window via `$parameter` - purge cron respects it live
 * - Admin API for inspecting sent notifications
 *
 * **Delivery mode** is decided at runtime by the `$job` system:
 * - If your app loads `AlephaApiJobsQueue` (and thus `AlephaQueue`), notifications
 *   go through the queue (best for high-volume systems).
 * - Otherwise, notifications run in **direct** mode: pushed to the outbox table
 *   and processed in the same process right after the HTTP response is returned.
 *   The reconciliation sweep is the safety net for crashes / retries.
 *
 * Direct mode is the recommended default for small / cheap deployments
 * (Cloudflare Workers, single-instance Node) - no queue infrastructure required.
 *
 * ## ⚠️ An app that uses the inbox owns its deletion cleanup
 *
 * `notification_inbox.userId` is a bare uuid with **no foreign key**: this
 * module imports nothing from `alepha/api/users`, so there is no table to
 * point at and nothing cascades. Deleting an account therefore leaves its
 * messages behind unless the app removes them.
 *
 * The seam is `user:delete:before`, and the call is
 * `NotificationInboxService.deleteForUser(userId)`. Put it in the handler
 * the app already has there, **after** whatever refusal that handler
 * performs: a separate handler can run first and wipe the inbox of an
 * account whose deletion is then refused.
 *
 * The hourly purge covers the other half, expiry, and only ever removes
 * messages that have been READ.
 *
 * @module alepha.api.notifications
 */
export const AlephaApiNotifications = $module({
  name: "alepha.api.notifications",
  imports: [AlephaApiJobs, AlephaApiParameters],
  primitives: [$notification],
  services: [
    // ⚠️ The two built-in channels are listed HERE, not merely exported.
    // `alepha.services()` filters instantiated services, so a channel nobody
    // injects is invisible to the registry and the boot check fires against
    // the framework's own templates.
    NotificationEmailChannel,
    NotificationSmsChannel,
    NotificationInboxChannel,
    NotificationChannelService,
    NotificationSenderService,
    NotificationSettings,
    NotificationSuppressionService,
    NotificationDeliveryService,
    NotificationAttachmentService,
    NotificationInboxService,
    NotificationIngestService,
    NotificationUnsubscribeService,
    NotificationPreferenceProvider,
    NotificationInboxRecipientProvider,
    NotificationJobs,
    AdminNotificationController,
    NotificationInboxController,
    NotificationUnsubscribeController,
    NotificationWebhookController,
  ],
});
