import { $module } from "alepha";
import { AlephaApiJobsQueue } from "alepha/api/jobs";
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
 * - Queue-based delivery with retry and audit trail (`record: "all"` + no ring buffer trim)
 * - Runtime-editable retention window via `$parameter` — purge cron respects it live
 * - Admin API for inspecting sent notifications
 *
 * @module alepha.api.notifications
 */
export const AlephaApiNotifications = $module({
  name: "alepha.api.notifications",
  imports: [AlephaApiJobsQueue, AlephaApiParameters],
  primitives: [$notification],
  services: [
    NotificationSenderService,
    NotificationJobs,
    AdminNotificationController,
  ],
});
