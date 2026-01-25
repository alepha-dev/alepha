import { $module } from "alepha";
import { AdminNotificationController } from "./controllers/AdminNotificationController.ts";
import { NotificationJobs } from "./jobs/NotificationJobs.ts";
import { $notification } from "./primitives/$notification.ts";
import { NotificationQueues } from "./queues/NotificationQueues.ts";
import { NotificationSenderService } from "./services/NotificationSenderService.ts";
import {
  NotificationService,
  notificationServiceEnvSchema,
} from "./services/NotificationService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./controllers/AdminNotificationController.ts";
export * from "./entities/notifications.ts";
export * from "./jobs/NotificationJobs.ts";
export * from "./primitives/$notification.ts";
export * from "./queues/NotificationQueues.ts";
export * from "./schemas/notificationContactPreferencesSchema.ts";
export * from "./schemas/notificationCreateSchema.ts";
export * from "./schemas/notificationQuerySchema.ts";
export * from "./services/NotificationSenderService.ts";
export * from "./services/NotificationService.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | backend | standard | stable |
 *
 * User notification management.
 *
 * **Features:**
 * - Notification definitions
 * - Email/SMS notification sending
 * - Status tracking
 * - User preferences
 * - Queue integration
 *
 * @module alepha.api.notifications
 */
export const AlephaApiNotifications = $module({
  name: "alepha.api.notifications",
  primitives: [$notification],
  services: [
    AdminNotificationController,
    NotificationService,
    NotificationSenderService,
    NotificationQueues,
    NotificationJobs,
  ],
  register: (alepha) => {
    const env = alepha.parseEnv(notificationServiceEnvSchema);
    if (env.NOTIFICATION_QUEUE) {
      alepha.with(NotificationQueues);
    }

    alepha
      .with(AdminNotificationController)
      .with(NotificationService)
      .with(NotificationSenderService)
      .with(NotificationJobs);
  },
});
