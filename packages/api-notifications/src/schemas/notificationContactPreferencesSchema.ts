import { type Static, t } from "@alepha/core";

export const notificationContactPreferencesSchema = t.object({
	language: t.optional(t.text()),
	exclude: t.array(t.text()),
});

export type NotificationContactPreferences = Static<
	typeof notificationContactPreferencesSchema
>;
