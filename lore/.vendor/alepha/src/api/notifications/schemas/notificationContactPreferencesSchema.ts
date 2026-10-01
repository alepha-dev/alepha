import { type Infer, z } from "alepha";

/**
 * The **suggested** shape for an app's own notification preferences.
 *
 * The framework never reads this. It consumes a boolean from
 * `NotificationPreferenceProvider.allows()`, and an app is free to store
 * whatever it likes behind that seam. This schema exists to steer the first
 * implementor, because the shape is where the mistake gets made.
 *
 * ## Two axes, not one
 *
 * "No email at all" and "no email about this" are different answers, and an
 * unsubscribe link expresses the second. A preference model with a single
 * list of excluded things cannot say the first, and one with a single
 * on/off switch cannot say the second.
 *
 * That is precisely how the previous version of this schema died: it had one
 * axis (`exclude: string[]`), nothing in the ecosystem could express a real
 * preference with it, and it ended up exported and read by nothing.
 *
 * @example
 * ```typescript
 * const prefs: NotificationContactPreferences = {
 *   language: "fr",
 *   // Axis 1: this contact takes no SMS at all.
 *   channel: { email: true, sms: false },
 *   // Axis 2: they still take email, but not marketing email.
 *   categories: [{ name: "marketing", disabled: true }],
 * };
 * ```
 */
export const notificationContactPreferencesSchema = z.object({
  /**
   * Preferred language, as a plain tag such as `fr` or `fr-FR`.
   */
  language: z.text().optional(),
  /**
   * Whether the contact accepts a channel at all. An absent entry means yes.
   */
  channel: z
    .object({
      email: z.boolean().optional(),
      sms: z.boolean().optional(),
    })
    .optional(),
  /**
   * Per-category opt-outs, matching `$notification`'s `category`. An absent
   * entry means the category is accepted.
   */
  categories: z
    .array(
      z.object({
        name: z.text(),
        disabled: z.boolean(),
      }),
    )
    .optional(),
});

export type NotificationContactPreferences = Infer<
  typeof notificationContactPreferencesSchema
>;
