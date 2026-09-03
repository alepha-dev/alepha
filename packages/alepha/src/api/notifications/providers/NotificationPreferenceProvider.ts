/**
 * The seam through which an app answers "does this contact accept this
 * message?" from its own preference store.
 *
 * The framework owns the gate, the app owns the preference. Suppression (an
 * unsubscribe link, a bounce, a complaint) is framework state and lives in
 * `notification_suppressions`. Everything else is an app's own product
 * decision, with its own table and its own shape, and the framework
 * deliberately never learns it: it only consumes the boolean.
 *
 * The default allows everything, so an app that has no preferences does not
 * have to say so.
 *
 * ## An implementation is expected to consider both axes
 *
 * "No email at all" and "no email in this category" are different answers,
 * and the second is what an unsubscribe link expresses. Both arrive in the
 * arguments; answering on `template` alone is the mistake to avoid.
 *
 * @example
 * ```typescript
 * class ClubPreferences extends NotificationPreferenceProvider {
 *   protected readonly repo = $repository(preferenceEntity);
 *
 *   public override async allows(options: NotificationPreferenceOptions) {
 *     const row = await this.repo.findOne({
 *       where: { contact: options.contact },
 *     });
 *     if (!row) return true;
 *
 *     // Axis 1: the channel is off entirely.
 *     if (row.prefs.channel?.[options.channel] === false) return false;
 *
 *     // Axis 2: this one category is off.
 *     return !row.prefs.categories?.some(
 *       (it) => it.name === options.category && it.disabled,
 *     );
 *   }
 * }
 * ```
 *
 * Substitute it the usual way:
 *
 * ```typescript
 * alepha.with({
 *   provide: NotificationPreferenceProvider,
 *   use: ClubPreferences,
 * });
 * ```
 */
export class NotificationPreferenceProvider {
  /**
   * Whether this contact accepts this message.
   *
   * Called at send time, inside a job with no request context, so anything
   * it needs must come from the arguments rather than from the current
   * tenant or the current user.
   *
   * It is consulted **after** the suppression check and never overrides it:
   * returning true cannot resurrect an address that bounced or complained.
   */
  public async allows(
    _options: NotificationPreferenceOptions,
  ): Promise<boolean> {
    return true;
  }
}

export interface NotificationPreferenceOptions {
  /**
   * The normalized address or number the message is going to.
   */
  contact: string;
  channel: string;
  /**
   * The `$notification` template's name.
   */
  template: string;
  /**
   * The template's category, when it declares one.
   */
  category?: string;
  /**
   * The owning tenant, from the job payload. Undefined in a single-tenant
   * app, and never read from the current request: there is none.
   */
  organizationId?: string;
  /**
   * Whether the template is marked `critical`. A critical message is one the
   * recipient needs in order to use their account (a password reset, a
   * sign-in code). Refusing one is allowed but rarely right.
   */
  critical?: boolean;
}
