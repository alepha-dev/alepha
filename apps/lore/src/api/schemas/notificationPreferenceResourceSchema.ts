import { type Infer, z } from "alepha";

/**
 * What the account page needs to draw the whole form.
 *
 * `categories` rides along because the page cannot ask the framework for it:
 * `AdminNotificationController.listNotificationTemplates` is behind
 * `admin:notification:read`, so a user reading their own preferences would
 * get a 403. Lore reads the registered templates in process instead, which
 * is no query and no framework change.
 */
export const notificationPreferenceResourceSchema = z.object({
  /**
   * Whether email is on at all. There is no `inboxEnabled`: a bell you have
   * silenced is a feature you have deleted.
   */
  emailEnabled: z.boolean(),
  /**
   * Categories this person has switched off, on both channels.
   */
  mutedCategories: z.array(z.text()),
  /**
   * Every category a template in this app declares, minus the `critical`
   * ones - a password reset is not something to offer an opt-out from.
   */
  categories: z.array(z.text()),
});

export type NotificationPreferenceResource = Infer<
  typeof notificationPreferenceResourceSchema
>;
