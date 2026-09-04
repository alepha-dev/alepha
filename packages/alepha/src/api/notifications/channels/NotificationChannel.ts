import { AlephaError } from "alepha";

import type { NotificationPayload } from "../schemas/notificationPayloadSchema.ts";

/**
 * What a channel produced for one message.
 *
 * The base fields are the only ones anything outside the channel reads: the
 * sender writes them into the delivery receipt, and the admin preview
 * returns them as-is. A channel that needs to carry more (an email's
 * headers, a sink's resolved webhook) widens `R` with its own fields, which
 * stay private to the channel by construction, since no caller ever looks
 * past this interface.
 */
export interface NotificationRendered {
  /**
   * Who or where this went, written straight into the receipt's `contact`
   * column, which is `NOT NULL`.
   *
   * An addressable channel returns the contact it was given; a sink returns
   * `<channel>:<destination>`, e.g. `discord:releases`. One field, so the
   * sender never has to branch on the kind of channel it is talking to.
   */
  recipient: string;
  /**
   * What the receipt stores and the preview shows as the message's title.
   * Absent on a channel that has no notion of one.
   */
  subject?: string | null;
  /**
   * The message itself: HTML for email, the text for sms and for sinks.
   */
  body?: string | null;
  /**
   * The plain-text alternative, when the channel has both.
   */
  text?: string | null;
}

/**
 * Everything a channel needs to render, resolved by the sender.
 */
export interface NotificationRenderInput<M> {
  /**
   * The channel's own option block, taken from the template with the
   * `translations` entry for the payload's language already applied.
   */
  message: M;
  /**
   * The template's variables, as pushed.
   */
  variables: Record<string, unknown>;
  /**
   * The queued payload, for anything the channel needs beyond the
   * variables: the contact, the category, `critical`, the owning tenant.
   */
  payload: NotificationPayload;
}

/**
 * One delivery channel, and the extension point of the whole module.
 *
 * A channel is a **service**, not a primitive: it has dependencies (an http
 * client, an options atom, a boot-time config check) and this codebase
 * models transports as services. Discovery is `alepha.services()`.
 *
 * ⚠️ **A channel must be listed in its module's `services[]`.**
 * `alepha.services()` walks the registry and filters on `instanceof`, so it
 * sees *instantiated* services only: a channel that is exported but never
 * injected is invisible, and the symptom is the boot check refusing a
 * template that declares your own channel.
 *
 * @example A sink channel in a plugin package
 * ```ts
 * export class DiscordNotificationChannel extends NotificationChannel<DiscordMessage> {
 *   public readonly channel = "discord";
 *   public readonly addressable = false;
 *
 *   public async render(input: NotificationRenderInput<DiscordMessage>) {
 *     const to = input.message.to ?? "default";
 *     return { recipient: `discord:${to}`, body: await resolve(input) };
 *   }
 *
 *   public async send(rendered: DiscordRendered) {
 *     // POST to the webhook
 *     return {};
 *   }
 * }
 * ```
 */
export abstract class NotificationChannel<
  M = unknown,
  R extends NotificationRendered = NotificationRendered,
> {
  /**
   * The channel's name, and the key a template declares it under:
   * `$notification({ discord: { ... } })` is served by the channel whose
   * `channel` is `"discord"`.
   *
   * It is also what lands in `notification_deliveries.channel`, so it is a
   * short identifier, never prose.
   */
  abstract readonly channel: string;

  /**
   * Whether this channel delivers to a **person** or to a **place**.
   *
   * `true` keeps the whole gate: the suppression list, the app's preference
   * provider, the unsubscribe token and its `List-Unsubscribe` headers.
   *
   * `false` is a sink: it fires at a destination named in the template, so
   * there is nobody to suppress and nothing to opt out of. Running the gate
   * on a destination name would let a bounce on somebody's address silence
   * an ops alert.
   */
  abstract readonly addressable: boolean;

  /**
   * Produce the message without sending it.
   *
   * Split from {@link send} because the admin preview renders without
   * sending. There is no target parameter: an addressable channel's
   * recipient is on the payload, and a sink's destination comes from its own
   * option block.
   */
  abstract render(input: NotificationRenderInput<M>): Promise<R>;

  /**
   * Hand the rendered message to the transport.
   *
   * Throwing is how a failure is reported: the caller writes a `failed`
   * receipt and rethrows, so the job records the error and retries.
   */
  abstract send(rendered: R): Promise<{ messageId?: string }>;

  /**
   * What the delivery receipt records as the provider.
   *
   * Defaults to this channel's own class name. A channel that is a thin
   * adapter over a swappable transport overrides it to name that transport
   * instead: `NotificationEmailChannel` returns its `EmailProvider`'s class
   * name, so the audit trail keeps saying `BrevoEmailProvider` rather than
   * the channel that wrapped it.
   */
  public providerName(): string {
    return this.constructor.name;
  }

  /**
   * The contact this message is addressed to.
   *
   * For an addressable channel only: `contact` is optional on the payload
   * because a sink has none, and a channel that needs one would otherwise
   * have to widen `recipient` to `string | undefined` and push the problem
   * into the receipt's NOT NULL column.
   *
   * The sender refuses an addressable send with no contact before it ever
   * gets here, so reaching this throw means a payload built by hand.
   */
  protected requireContact(payload: NotificationPayload): string {
    const contact = payload.contact;
    if (!contact) {
      throw new AlephaError(
        `Notification "${payload.template}" has no contact, which channel "${this.channel}" needs.`,
      );
    }
    return contact;
  }
}
