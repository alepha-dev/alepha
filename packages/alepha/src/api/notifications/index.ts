import { $module } from "alepha";
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
 * - Notification definitions
 * - Email/SMS notification sending
 * - Job-based delivery with retry and tracking
 * - User preferences
 *
 * @module alepha.api.notifications
 */
export const AlephaApiNotifications = $module({
  name: "alepha.api.notifications",
  primitives: [$notification],
  services: [
    NotificationSenderService,
    NotificationJobs,
    AdminNotificationController,
  ],
  register: (alepha) => {
    alepha
      .with(NotificationSenderService)
      .with(NotificationJobs)
      .with(AdminNotificationController);
  },
});
