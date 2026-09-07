import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

/**
 * What a person has turned off.
 *
 * Lore's table, not the framework's, and that is the design rather than a
 * convenience: `NotificationPreferenceProvider` is a **read seam** with no
 * table and no write API, because a preference is an app's own product
 * decision with its own shape. The framework consumes a boolean and
 * deliberately never learns how it was reached.
 *
 * ## An absent row means everything is allowed
 *
 * Nobody is backfilled, and a new account has no row until it turns
 * something off. The provider treats a missing row as "yes".
 *
 * ## ⚠️ Keyed on `userId`, never on the email address
 *
 * The gate arrives with a `contact`, so keying on it would save a join - and
 * would silently reset somebody's settings the day they change their
 * address, which is exactly why `notification_inbox` does not key on it
 * either. The provider joins through `users` instead.
 *
 * ## ⚠️ There is no `inbox` channel switch, and that is deliberate
 *
 * A bell you have silenced is a feature you have deleted: a message nobody
 * can see is indistinguishable from a message that was never sent. So the
 * channel switch exists for `email` alone, while categories switch both.
 */
export const notificationPreferences = $entity({
  name: "notification_preferences",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    /**
     * A real foreign key, unlike `notification_inbox.userId`: this is a Lore
     * table and `users` is right there, so account deletion cascades and
     * needs no hand-written hook.
     */
    userId: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    /**
     * Whether this person still wants email at all. `false` silences every
     * category on that channel.
     */
    emailEnabled: db.default(z.boolean(), true),
    /**
     * Categories switched off, as template category names (`mentions`,
     * `releases`). One list for both channels: "I do not care about releases"
     * is one preference, not two.
     *
     * ⚠️ A `critical` template is never gated by this in practice - the
     * framework passes `critical` and the provider refuses to honour a
     * category switch for one, because a password reset somebody opted out
     * of is an account they cannot get back into.
     */
    mutedCategories: db.default(z.array(z.text({ maxLength: 100 })), []),
  }),
  indexes: [{ columns: ["userId"], unique: true }],
});

export type NotificationPreferences = Infer<
  typeof notificationPreferences.schema
>;
