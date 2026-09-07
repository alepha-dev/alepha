import { $inject, AlephaError } from "alepha";
import { $repository } from "alepha/orm";

import { notificationInboxEntity } from "../entities/notificationInboxEntity.ts";
import type { NotificationChannels } from "../primitives/$notification.ts";
import { NotificationInboxRecipientProvider } from "../providers/NotificationInboxRecipientProvider.ts";
import type { NotificationPayload } from "../schemas/notificationPayloadSchema.ts";
import {
  NotificationChannel,
  type NotificationRendered,
  type NotificationRenderInput,
} from "./NotificationChannel.ts";

/**
 * The `inbox` block of a template, with its translation already applied.
 */
export type NotificationInboxMessage = NonNullable<
  NotificationChannels<any>["inbox"]
>;

/**
 * What the inbox channel hands to its own transport, which is a table.
 *
 * `userId` rides here rather than on `recipient` deliberately. `recipient`
 * is written straight into `notification_deliveries.contact`, the operator's
 * only handle on a receipt, shown in the admin list, the detail page and the
 * suppression tab - and every other row there holds an address or
 * `discord:releases`. A raw uuid in that column would be unreadable. This
 * interface is exactly what `NotificationRendered`'s generic is documented
 * for: a channel that needs to carry more widens `R` with fields that stay
 * private to it, since no caller looks past the base contract.
 */
export interface NotificationInboxRendered extends NotificationRendered {
  userId: string;
  title: string;
  href: string;
  scope: string | null;
  scopeLabel: string | null;
  template: string;
  category: string | null;
  organizationId: string | null;
}

/**
 * The inbox, as the third implementation of the channel contract.
 *
 * `addressable = true`: it delivers to a **person**, so it keeps the whole
 * gate - the suppression list, the app's preference provider and the
 * unsubscribe token. It is not a sink, so there is no
 * `NotificationSinkChannels` entry and `push()` still demands a contact.
 *
 * Registered by default in `AlephaApiNotifications`' `services[]`, so an app
 * that declares an `inbox` block changes nothing to get it. The one thing it
 * does have to do is substitute {@link NotificationInboxRecipientProvider},
 * since the default resolves nobody.
 *
 * ## ⚠️ This class holds no resolution state, and must not
 *
 * The contact is resolved twice per message: once in `unavailable()`, to
 * decline before anything is rendered, and once in `render()`, to file the
 * row. The obvious saving is a field on the channel holding the last answer.
 *
 * **Do not.** A channel is a service, so there is exactly one instance for
 * the whole container, and sends interleave at every `await`. A cached "last
 * resolved user" delivers one person's message into another person's inbox -
 * silently, under concurrency only, and never in a unit test. Two indexed
 * lookups by contact is the correct price.
 */
export class NotificationInboxChannel extends NotificationChannel<
  NotificationInboxMessage,
  NotificationInboxRendered
> {
  protected readonly recipients = $inject(NotificationInboxRecipientProvider);
  protected readonly repo = $repository(notificationInboxEntity);

  public readonly channel = "inbox";
  public readonly addressable = true;

  /**
   * Decline a contact that belongs to nobody, before anything is rendered.
   *
   * Without this the only option would be throwing from `render()`, which is
   * called outside the sender's attempt wrapper: no receipt at all, and the
   * job retrying an address that will never resolve.
   */
  public override async unavailable(payload: NotificationPayload) {
    const contact = this.requireContact(payload);
    const user = await this.recipients.resolve(this.normalize(contact));
    if (user) {
      return undefined;
    }
    return { reason: "unresolved-recipient", recipient: contact };
  }

  public async render(
    input: NotificationRenderInput<NotificationInboxMessage>,
  ): Promise<NotificationInboxRendered> {
    const { message: inbox, variables, payload } = input;
    const contact = this.requireContact(payload);

    // Resolved again rather than carried over from `unavailable()`: see the
    // class docstring for why a field here would be a data leak.
    const user = await this.recipients.resolve(this.normalize(contact));
    if (!user) {
      throw new AlephaError(
        `Notification "${payload.template}" has no inbox recipient for "${contact}".`,
      );
    }

    return {
      recipient: contact,
      userId: user.userId,
      subject: await this.value(inbox.title, variables),
      title: await this.value(inbox.title, variables),
      body: inbox.body ? await this.value(inbox.body, variables) : null,
      href: await this.value(inbox.href, variables),
      scope: inbox.scope ? await this.value(inbox.scope, variables) : null,
      scopeLabel: inbox.scopeLabel
        ? await this.value(inbox.scopeLabel, variables)
        : null,
      template: payload.template,
      category: payload.category ?? null,
      organizationId: payload.organizationId ?? null,
    };
  }

  public async send(rendered: NotificationInboxRendered) {
    const row = await this.repo.create({
      userId: rendered.userId,
      scope: rendered.scope,
      scopeLabel: rendered.scopeLabel,
      template: rendered.template,
      category: rendered.category,
      title: rendered.title,
      body: rendered.body ?? null,
      href: rendered.href,
      readAt: null,
      organizationId: rendered.organizationId,
    });

    // The row's own id, so a receipt points at the message it produced.
    return { messageId: row.id };
  }

  /**
   * Resolve one option, which is a string or a function of the variables.
   */
  protected async value(
    option: string | ((variables: any) => string | Promise<string>),
    variables: Record<string, unknown>,
  ): Promise<string> {
    return typeof option === "function" ? await option(variables) : option;
  }

  /**
   * The same normalization the suppression list applies, so an address the
   * user typed with a capital letter still finds them.
   */
  protected normalize(contact: string): string {
    return contact.trim().toLowerCase();
  }
}
