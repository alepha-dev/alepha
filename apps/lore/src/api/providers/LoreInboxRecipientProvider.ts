import { NotificationInboxRecipientProvider } from "alepha/api/notifications";
import { $repository } from "alepha/orm";

import { users } from "../entities/users.ts";

/**
 * Who an email address belongs to, for the inbox channel.
 *
 * `push({ contact })` hands one string to every channel: email wants the
 * address, the inbox wants somebody to file the message under. This is
 * Lore's half of that seam, substituted for the framework's default in
 * `main.server.ts`, which resolves nobody.
 *
 * ⚠️ **Normalize, and normalize both sides.** The channel lower-cases the
 * contact before asking, because the sender hands it `payload.contact` raw.
 * `users.email` is not guaranteed to be normalized either, so the comparison
 * is done on a lower-cased column rather than on the stored spelling: an
 * address typed with a capital letter must still find its owner.
 *
 * Returning null is not an error. It is how Lore says this address belongs
 * to nobody it knows, which is ordinary for a message addressed to somebody
 * who never signed up. The channel turns it into a `skipped` receipt, so the
 * job ends `ok` rather than retrying an address that will never resolve.
 */
export class LoreInboxRecipientProvider extends NotificationInboxRecipientProvider {
  protected readonly users = $repository(users);

  public override async resolve(
    contact: string,
  ): Promise<{ userId: string } | null> {
    const email = contact.trim().toLowerCase();
    if (!email) return null;

    const user = await this.users.findOne({ where: { email: { eq: email } } });
    return user ? { userId: user.id } : null;
  }
}
