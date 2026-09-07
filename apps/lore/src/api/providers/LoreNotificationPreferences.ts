import {
  type NotificationPreferenceOptions,
  NotificationPreferenceProvider,
} from "alepha/api/notifications";
import { $repository } from "alepha/orm";

import { notificationPreferences } from "../entities/notificationPreferences.ts";
import { users } from "../entities/users.ts";

/**
 * Whether this person still wants to be told, by this channel, about this
 * kind of thing.
 *
 * Substituted for the framework's default, which allows everything.
 *
 * ## ⚠️ Both axes, and the order between them
 *
 * "No email at all" and "no email about releases" are different answers, and
 * answering on `template` alone is the mistake the seam's own docstring names.
 * The channel switch is checked first because it is the broader one; the
 * category switch then applies to whichever channel survived it.
 *
 * ## ⚠️ The lookup is a join, once per channel per message
 *
 * `NotificationPreferenceOptions` carries a **`contact`**, not a user id, so
 * this resolves the address to a user and then reads their row. That is two
 * indexed reads per channel per message: a release fan-out over ten members
 * does forty. Deliberate, and fine at Lore's scale - the alternative is
 * keying the table on the email address, which silently resets everybody's
 * settings the day they change it. If this ever shows up in a trace, the
 * cache goes here, keyed on the normalized contact, with a lifetime shorter
 * than a job run.
 *
 * The contact is normalized the way `NotificationSuppressionService` does,
 * because a stored address whose case differs from the payload's would
 * otherwise have a preference that is never found and therefore never
 * honoured.
 *
 * ## It never overrides suppression
 *
 * The framework consults this **after** the suppression list, so returning
 * true cannot resurrect an address that bounced or complained. Nothing here
 * has to know that; it is worth knowing when reading a spec that asserts it.
 */
export class LoreNotificationPreferences extends NotificationPreferenceProvider {
  protected readonly users = $repository(users);
  protected readonly prefs = $repository(notificationPreferences);

  public override async allows(
    options: NotificationPreferenceOptions,
  ): Promise<boolean> {
    const row = await this.rowFor(options.contact);
    // Nobody is backfilled: no row means nothing has been turned off.
    if (!row) return true;

    // Axis one: the channel, off entirely. Only `email` has this switch - a
    // bell you have silenced is a feature you have deleted.
    if (options.channel === "email" && row.emailEnabled === false) {
      return false;
    }

    // Axis two: this one category. Never for a critical template: a password
    // reset somebody opted out of is an account they cannot get back into.
    if (
      !options.critical &&
      options.category &&
      row.mutedCategories.includes(options.category)
    ) {
      return false;
    }

    return true;
  }

  /**
   * This contact's preference row, or undefined when they have none, or are
   * nobody Lore knows.
   */
  protected async rowFor(contact: string) {
    const email = contact.trim().toLowerCase();
    if (!email) return undefined;

    const user = await this.users.findOne({
      where: { email: { eqInsensitive: email } },
    });
    if (!user) return undefined;

    return await this.prefs.findOne({ where: { userId: { eq: user.id } } });
  }
}
