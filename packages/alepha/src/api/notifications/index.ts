import { $module } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaApiParameters } from "alepha/api/parameters";

import { NotificationEmailChannel } from "./channels/NotificationEmailChannel.ts";
import { NotificationSmsChannel } from "./channels/NotificationSmsChannel.ts";
import { AdminNotificationController } from "./controllers/AdminNotificationController.ts";
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
import { NotificationIngestService } from "./services/NotificationIngestService.ts";
import { NotificationSenderService } from "./services/NotificationSenderService.ts";
import { NotificationSettings } from "./services/NotificationSettings.ts";
import { NotificationSuppressionService } from "./services/NotificationSuppressionService.ts";
import { NotificationUnsubscribeService } from "./services/NotificationUnsubscribeService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./channels/NotificationChannel.ts";
export * from "./channels/NotificationEmailChannel.ts";
export * from "./channels/NotificationSmsChannel.ts";
export * from "./controllers/AdminNotificationController.ts";
export * from "./controllers/NotificationUnsubscribeController.ts";
export * from "./controllers/NotificationWebhookController.ts";
export * from "./entities/notificationDeliveryEntity.ts";
export * from "./entities/notificationSuppressionEntity.ts";
export * from "./jobs/NotificationJobs.ts";
export * from "./primitives/$notification.ts";
export * from "./providers/NotificationInboxRecipientProvider.ts";
export * from "./providers/NotificationPreferenceProvider.ts";
export * from "./schemas/notificationAttachmentSchema.ts";
export * from "./schemas/notificationContactPreferencesSchema.ts";
export * from "./schemas/notificationDeliveryEventSchema.ts";
export * from "./schemas/notificationDetailResourceSchema.ts";
export * from "./schemas/notificationPayloadSchema.ts";
export * from "./schemas/notificationPreviewResourceSchema.ts";
export * from "./schemas/notificationQuerySchema.ts";
export * from "./schemas/notificationResourceSchema.ts";
export * from "./schemas/notificationSuppressionResourceSchema.ts";
export * from "./schemas/notificationTemplateResourceSchema.ts";
export * from "./services/NotificationAttachmentService.ts";
export * from "./services/NotificationChannelService.ts";
export * from "./services/NotificationDeliveryService.ts";
export * from "./services/NotificationIngestService.ts";
export * from "./services/NotificationSenderService.ts";
export * from "./services/NotificationSettings.ts";
export * from "./services/NotificationSuppressionService.ts";
export * from "./services/NotificationUnsubscribeService.ts";

// ---------------------------------------------------------------------------------------------------------------------

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
    NotificationChannelService,
    NotificationSenderService,
    NotificationSettings,
    NotificationSuppressionService,
    NotificationDeliveryService,
    NotificationAttachmentService,
    NotificationIngestService,
    NotificationUnsubscribeService,
    NotificationPreferenceProvider,
    NotificationInboxRecipientProvider,
    NotificationJobs,
    AdminNotificationController,
    NotificationUnsubscribeController,
    NotificationWebhookController,
  ],
});
