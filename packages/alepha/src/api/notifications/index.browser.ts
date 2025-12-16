import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./controllers/NotificationController.ts";
export * from "./entities/notifications.ts";
export * from "./schemas/notificationContactPreferencesSchema.ts";
export * from "./schemas/notificationContactSchema.ts";
export * from "./schemas/notificationCreateSchema.ts";
export * from "./schemas/notificationQuerySchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaApiNotifications = $module({
  name: "alepha.api.notifications",
  services: [],
});
