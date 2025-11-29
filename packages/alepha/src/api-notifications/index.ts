import { $module } from "alepha";
import { NotificationController } from "./controllers/NotificationController.ts";
import { $notification } from "./descriptors/$notification.ts";
import { NotificationJobs } from "./jobs/NotificationJobs.ts";
import { MemorySmsProvider } from "./providers/MemorySmsProvider.ts";
import { SmsProvider } from "./providers/SmsProvider.ts";
import { NotificationQueues } from "./queues/NotificationQueues.ts";
import { NotificationSenderService } from "./services/NotificationSenderService.ts";
import {
  NotificationService,
  notificationServiceEnvSchema,
} from "./services/NotificationService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./controllers/NotificationController.ts";
export * from "./descriptors/$notification.ts";
export * from "./entities/notifications.ts";
export * from "./jobs/NotificationJobs.ts";
export * from "./providers/MemorySmsProvider.ts";
export * from "./providers/SmsProvider.ts";
export * from "./queues/NotificationQueues.ts";
export * from "./schemas/notificationContactPreferencesSchema.ts";
export * from "./schemas/notificationCreateSchema.ts";
export * from "./services/NotificationSenderService.ts";
export * from "./services/NotificationService.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides notification management API endpoints for Alepha applications.
 *
 * This module includes notification sending, retrieval, status tracking,
 * and user notification preferences management.
 *
 * @module alepha.api.notifications
 */
export const AlephaApiNotifications = $module({
  name: "alepha.api.notifications",
  descriptors: [$notification],
  services: [
    NotificationController,
    NotificationService,
    NotificationSenderService,
    NotificationQueues,
    NotificationJobs,
    SmsProvider,
    MemorySmsProvider,
  ],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: SmsProvider,
      use: MemorySmsProvider,
    });

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
