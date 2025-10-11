import { $module } from "@alepha/core";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./entities/notifications.ts";

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
	services: [],
});
