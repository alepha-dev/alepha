import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./schemas/notificationContactPreferencesSchema.ts";
export * from "./schemas/notificationContactSchema.ts";
export * from "./schemas/notificationDetailResourceSchema.ts";
export * from "./schemas/notificationPayloadSchema.ts";
export * from "./schemas/notificationQuerySchema.ts";
export * from "./schemas/notificationResourceSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaApiNotifications = $module({
  name: "alepha.api.notifications",
  services: [],
});
