import { type Static, z } from "alepha";

export const notificationContactPreferencesSchema = z.object({
  language: z.text().optional(),
  exclude: z.array(z.text()),
});

export type NotificationContactPreferences = Static<
  typeof notificationContactPreferencesSchema
>;
