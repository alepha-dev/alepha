import { $module } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaApiParameters } from "alepha/api/parameters";

import { AdminNotificationController } from "./controllers/AdminNotificationController.ts";
import { NotificationJobs } from "./jobs/NotificationJobs.ts";
import { $notification } from "./primitives/$notification.ts";
import { NotificationSenderService } from "./services/NotificationSenderService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./controllers/AdminNotificationController.ts";
export * from "./jobs/NotificationJobs.ts";
export * from "./primitives/$notification.ts";
export * from "./schemas/notificationContactPreferencesSchema.ts";
export * from "./schemas/notificationContactSchema.ts";
export * from "./schemas/notificationDetailResourceSchema.ts";
export * from "./schemas/notificationPayloadSchema.ts";
export * from "./schemas/notificationQuerySchema.ts";
export * from "./schemas/notificationResourceSchema.ts";
export * from "./services/NotificationSenderService.ts";

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
    NotificationSenderService,
    NotificationJobs,
    AdminNotificationController,
  ],
});
