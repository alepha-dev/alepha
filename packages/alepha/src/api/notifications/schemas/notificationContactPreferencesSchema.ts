import { type Static, t } from "alepha";

export const notificationContactPreferencesSchema = t.object({
  language: t.optional(t.text()),
  exclude: t.array(t.text()),
});

export type NotificationContactPreferences = Static<
  typeof notificationContactPreferencesSchema
>;
