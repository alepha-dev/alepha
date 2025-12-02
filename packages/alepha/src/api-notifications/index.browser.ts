import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./entities/notifications.ts";
export * from "./schemas/notificationContactPreferencesSchema.ts";
export * from "./schemas/notificationContactSchema.ts";
export * from "./schemas/notificationCreateSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaApiNotifications = $module({
  name: "alepha.api.notifications",
  services: [],
});
