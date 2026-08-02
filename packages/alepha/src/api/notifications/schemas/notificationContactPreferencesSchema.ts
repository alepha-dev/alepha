import { type Infer, z } from "alepha";

export const notificationContactPreferencesSchema = z.object({
  language: z.text().optional(),
  exclude: z.array(z.text()),
});

export type NotificationContactPreferences = Infer<
  typeof notificationContactPreferencesSchema
>;
