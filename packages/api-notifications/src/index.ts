import { $module } from "@alepha/core";
import { NotificationController } from "./controllers/NotificationController.ts";
import { $notification } from "./descriptors/$notification.ts";
import { NotificationJobs } from "./jobs/NotificationJobs.ts";
import { NotificationQueues } from "./queues/NotificationQueues.ts";
import { NotificationSenderService } from "./services/NotificationSenderService.ts";
import { NotificationService } from "./services/NotificationService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./controllers/NotificationController.ts";
export * from "./descriptors/$notification.ts";
export * from "./entities/notifications.ts";
export * from "./jobs/NotificationJobs.ts";
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
	],
});
