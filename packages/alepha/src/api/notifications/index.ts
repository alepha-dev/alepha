import { $module } from "alepha";
import { NotificationController } from "./controllers/NotificationController.ts";
import { NotificationJobs } from "./jobs/NotificationJobs.ts";
import { $notification } from "./primitives/$notification.ts";
import { NotificationQueues } from "./queues/NotificationQueues.ts";
import { NotificationSenderService } from "./services/NotificationSenderService.ts";
import {
  NotificationService,
  notificationServiceEnvSchema,
} from "./services/NotificationService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./controllers/NotificationController.ts";
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
 * Provides notification management API endpoints for Alepha applications.
 *
 * This module includes notification sending, retrieval, status tracking,
 * and user notification preferences management.
 *
 * Requires `AlephaSms` module to be loaded for SMS notifications.
 *
 * @module alepha.api.notifications
 */
export const AlephaApiNotifications = $module({
  name: "alepha.api.notifications",
  primitives: [$notification],
  services: [
    NotificationController,
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
      .with(NotificationController)
      .with(NotificationService)
      .with(NotificationSenderService)
      .with(NotificationJobs);
  },
});
