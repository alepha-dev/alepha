import { $inject } from "alepha";
import {
  type EmailAttachment,
  EmailProvider,
  EmailTextRenderer,
} from "alepha/email";

import type { NotificationChannels } from "../primitives/$notification.ts";
import { NotificationAttachmentService } from "../services/NotificationAttachmentService.ts";
import { NotificationUnsubscribeService } from "../services/NotificationUnsubscribeService.ts";
import {
  NotificationChannel,
  type NotificationRendered,
  type NotificationRenderInput,
} from "./NotificationChannel.ts";

/**
 * The `email` block of a template, with its translation already applied.
 */
export type NotificationEmailMessage = NonNullable<
  NotificationChannels<any>["email"]
>;

/**
 * What the email channel hands to its transport.
 *
 * `to` sits beside the contract's `recipient` and holds the same value: the
 * receipt reads `recipient` without knowing which channel wrote it, while
 * `EmailSendOptions` wants a field called `to`. Spelling both is cheaper than
 * a mapping step nobody would remember exists.
 */
export interface NotificationEmailRendered extends NotificationRendered {
  to: string;
  subject: string;
  body: string;
  text: string;
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
}

/**
 * Email, as the first implementation of the channel contract.
 *
 * Registered by default in `AlephaApiNotifications`' `services[]`, so an app
 * that declares an `email` block changes nothing to get it.
 */
export class NotificationEmailChannel extends NotificationChannel<
  NotificationEmailMessage,
  NotificationEmailRendered
> {
  protected readonly emailProvider = $inject(EmailProvider);
  protected readonly textRenderer = $inject(EmailTextRenderer);
  protected readonly unsubscribeTokens = $inject(
    NotificationUnsubscribeService,
  );
  protected readonly attachmentService = $inject(NotificationAttachmentService);

  public readonly channel = "email";
  public readonly addressable = true;

  /**
   * The transport's class name, not this channel's.
   *
   * A receipt has to keep saying `BrevoEmailProvider`: the channel is an
   * adapter over a swappable transport, and the transport is what an
   * operator is looking for when a message did not arrive.
   */
  public override providerName(): string {
    return this.emailProvider.constructor.name;
  }

  public async render(
    input: NotificationRenderInput<NotificationEmailMessage>,
  ): Promise<NotificationEmailRendered> {
    const { message: email, variables, payload } = input;
    const contact = payload.contact;

    // A critical template carries no unsubscribe link: there is nothing to
    // opt out of, and offering one would suggest a password reset can be
    // switched off. Undefined also when PUBLIC_URL is unset.
    const unsubscribeUrl = payload.critical
      ? undefined
      : this.unsubscribeTokens.urlFor({
          contact: contact,
          channel: this.channel,
          category: payload.category,
          template: payload.template,
          organizationId: payload.organizationId,
        });

    // The body sees it as one more variable, so an app can put a visible
    // link in its own footer. The framework never injects markup into a body
    // it does not own.
    const renderVariables = { ...(variables as object), unsubscribeUrl };

    // Resolved here rather than above the unsubscribe block so it sees the
    // same values the body does.
    const subject =
      typeof email.subject === "function"
        ? await email.subject(renderVariables as any)
        : email.subject;

    const body =
      typeof email.body === "function"
        ? await email.body(renderVariables as any)
        : email.body;

    // A template's own text always wins. Deriving one when it is absent is
    // what gets every existing template a plain-text part without any of
    // them being rewritten, which is the whole point: an HTML-only message
    // scores worse with every spam filter.
    const declared =
      typeof email.text === "function"
        ? await email.text(renderVariables as any)
        : email.text;
    const text = declared ?? this.textRenderer.fromHtml(body);

    // Framework-set, never caller-set, so there is nothing for the header
    // policy to refuse here. It guards `$email.send()`, where the map does
    // come from a caller.
    const headers = unsubscribeUrl
      ? {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        }
      : undefined;

    // Bytes are fetched here and nowhere earlier. A missing object throws,
    // which fails the send rather than quietly delivering an invoice email
    // with no invoice.
    const attachments = await this.attachmentService.resolve(
      payload.attachments,
      { organizationId: payload.organizationId },
    );

    return {
      recipient: contact,
      to: contact,
      subject,
      body,
      text,
      headers,
      attachments,
    };
  }

  public async send(rendered: NotificationEmailRendered) {
    return this.emailProvider.send({
      to: rendered.to,
      subject: rendered.subject,
      body: rendered.body,
      text: rendered.text,
      headers: rendered.headers,
      attachments: rendered.attachments,
    });
  }
}
