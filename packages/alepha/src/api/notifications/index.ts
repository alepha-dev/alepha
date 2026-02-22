import { $module } from "alepha";
import { NotificationJobs } from "./jobs/NotificationJobs.ts";
import { $notification } from "./primitives/$notification.ts";
import { NotificationSenderService } from "./services/NotificationSenderService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./jobs/NotificationJobs.ts";
export * from "./primitives/$notification.ts";
export * from "./schemas/notificationContactPreferencesSchema.ts";
export * from "./schemas/notificationContactSchema.ts";
export * from "./schemas/notificationPayloadSchema.ts";
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
  services: [NotificationSenderService, NotificationJobs],
  register: (alepha) => {
    alepha.with(NotificationSenderService).with(NotificationJobs);
  },
});
