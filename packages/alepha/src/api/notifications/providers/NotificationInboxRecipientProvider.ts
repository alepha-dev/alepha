/**
 * The seam through which an app turns a contact into one of its users.
 *
 * `push({ contact })` hands **one string to every channel**. Email wants an
 * address, and the inbox wants somebody to file a message under. This is
 * how those two answers come from the same string without the notifications
 * module learning what a user is.
 *
 * The framework owns the gate, the app owns the identity: the same split
 * {@link NotificationPreferenceProvider} already states, and the reason this
 * exists rather than an import of `alepha/api/users`, which would couple two
 * modules that share nothing today.
 *
 * The default returns null, so an app that has not implemented it gets a
 * `skipped` receipt with the reason `unresolved-recipient` rather than a
 * crash - the same posture as an unimplemented preference provider allowing
 * everything.
 *
 * ## The contact arrives normalized
 *
 * Trimmed and lower-cased, the way `NotificationSuppressionService` already
 * normalizes before it looks anything up. The sender hands the channel
 * `payload.contact` raw, and an implementation looking `users` up by an
 * address somebody typed with a capital letter would find nothing. Normalize
 * on the way in as well: what is stored in `users.email` is not guaranteed
 * to be normalized either.
 *
 * @example
 * ```typescript
 * class LoreInboxRecipients extends NotificationInboxRecipientProvider {
 *   protected readonly users = $repository(userEntity);
 *
 *   public override async resolve(contact: string) {
 *     const user = await this.users.findOne({
 *       where: { email: contact.trim().toLowerCase() },
 *     });
 *     return user ? { userId: user.id } : null;
 *   }
 * }
 * ```
 *
 * Substitute it the usual way:
 *
 * ```typescript
 * alepha.with({
 *   provide: NotificationInboxRecipientProvider,
 *   use: LoreInboxRecipients,
 * });
 * ```
 */
export class NotificationInboxRecipientProvider {
  /**
   * Who this contact is, or null when nobody.
   *
   * Called at send time, inside a job with no request context, so anything
   * it needs must come from the argument rather than from the current user
   * or the current tenant.
   *
   * ⚠️ **Called twice per message, and that is deliberate.** The inbox
   * channel asks once in `unavailable()`, to decline before anything is
   * rendered, and again in `render()`, to file the row. It caches nothing
   * between the two: a channel is a service, so one instance serves every
   * concurrent send, and a "last resolved user" field would deliver one
   * person's message into another person's inbox. Two indexed lookups is
   * the correct price.
   *
   * Returning null is not an error. It is how an app says this address
   * belongs to nobody it knows, which is an ordinary outcome for a message
   * addressed to someone who never signed up.
   */
  public async resolve(_contact: string): Promise<{ userId: string } | null> {
    return null;
  }
}
