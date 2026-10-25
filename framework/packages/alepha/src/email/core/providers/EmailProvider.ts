/**
 * Email provider interface.
 *
 * All methods are asynchronous and return promises.
 */
export abstract class EmailProvider {
  /**
   * Send an email.
   *
   * @return Promise resolving to the transport's receipt for the message.
   */
  public abstract send(options: EmailSendOptions): Promise<EmailSendResult>;
}

export type EmailSendOptions = {
  to: string | string[];
  subject: string;
  /**
   * The HTML body. There is no template rendering here: bring your own.
   */
  body: string;
  /**
   * A plain-text alternative to {@link body}, sent as a second MIME part.
   *
   * Optional, and worth setting: an HTML-only message scores worse with every
   * spam filter than the same message with a text part beside it.
   */
  text?: string;
  /**
   * Address replies should go to, when it is not the configured sender.
   */
  replyTo?: string;
  /**
   * Extra headers to set on the message, for example `List-Unsubscribe`.
   *
   * ⚠️ A caller-controlled header map is a spoofing surface, so the
   * envelope headers (`From`, `To`, `Subject`, `Cc`, `Bcc`, `Reply-To`,
   * `Content-Type`) are refused before any provider sees them. Use
   * {@link EmailSendOptions.replyTo} rather than a `Reply-To` header.
   */
  headers?: Record<string, string>;
  /**
   * Files to attach, as bytes. Whoever builds this has already fetched them.
   *
   * Note the size limits are the transport's, not this type's: Brevo caps
   * the whole request, Cloudflare caps the message. A caller fanning out
   * over a roster should care.
   */
  attachments?: EmailAttachment[];
};

export type EmailAttachment = {
  filename: string;
  content: Uint8Array | string;
  contentType?: string;
  /**
   * Content-ID. Set it to reference the file inline from the body as
   * `<img src="cid:...">` instead of offering it as a download.
   */
  cid?: string;
};

/**
 * What the transport reported about a message it accepted.
 *
 * `messageId` is **the message's, not the recipient's**. Cloudflare passes a
 * `to: string[]` through as a single message with one id, so a caller that
 * needs one id per recipient must send one message per recipient. That is
 * exactly what the notification layer does, which is why its receipts line up
 * one-to-one with contacts.
 *
 * It is optional because a transport may not report one; every provider in
 * the tree does, minting a uuid where there is no upstream id to forward.
 */
export type EmailSendResult = {
  messageId?: string;
};
