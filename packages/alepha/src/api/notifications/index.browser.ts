import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./schemas/notificationContactPreferencesSchema.ts";
export * from "./schemas/notificationContactSchema.ts";
export * from "./schemas/notificationPayloadSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaApiNotifications = $module({
  name: "alepha.api.notifications",
  services: [],
});
