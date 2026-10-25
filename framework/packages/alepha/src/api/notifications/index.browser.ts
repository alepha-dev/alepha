import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./schemas/notificationContactPreferencesSchema.ts";
export * from "./schemas/notificationDetailResourceSchema.ts";
export * from "./schemas/notificationInboxCountSchema.ts";
export * from "./schemas/notificationInboxPageSchema.ts";
export * from "./schemas/notificationInboxQuerySchema.ts";
export * from "./schemas/notificationInboxResourceSchema.ts";
export * from "./schemas/notificationPayloadSchema.ts";
export * from "./schemas/notificationQuerySchema.ts";
export * from "./schemas/notificationResourceSchema.ts";
export * from "./schemas/notificationSuppressionResourceSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaApiNotifications = $module({
  name: "alepha.api.notifications",
  services: [],
});
