import { z } from "alepha";
export const monitorNotificationSettingsSchema = z.object({
  email: z.boolean().default(true),
  recipients: z.array(z.email()).max(20).default([]),
});
