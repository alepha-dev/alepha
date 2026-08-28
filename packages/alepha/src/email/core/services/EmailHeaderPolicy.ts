import { EmailError } from "../errors/EmailError.ts";

/**
 * Guards the headers a caller is allowed to set on an outgoing message.
 *
 * `EmailSendOptions.headers` exists so an app can set things like
 * `List-Unsubscribe`. It is also, unguarded, a spoofing surface: whoever can
 * set `From` can send mail as anyone the app's sending domain is trusted
 * for, and whoever can set `Bcc` can copy every message somewhere else.
 *
 * The envelope headers are therefore **refused rather than stripped**. A
 * caller that sets one has either a bug or bad intent, and silently dropping
 * it would send a message that is not the one that was asked for. `Reply-To`
 * is on the list because {@link EmailSendOptions.replyTo} is the supported
 * way to set it, and two sources for one header is how they disagree.
 *
 * One policy object, used by `$email.send()` and by the notification sender,
 * so the two paths cannot drift.
 */
export class EmailHeaderPolicy {
  /**
   * Lower-cased, because header names are case-insensitive and an attacker
   * would not send `From`.
   */
  protected readonly reserved = new Set([
    "from",
    "to",
    "subject",
    "cc",
    "bcc",
    "reply-to",
    "content-type",
  ]);

  /**
   * Throw if the map carries a header the caller may not set.
   *
   * Call it before anything observable happens: a refused send must not have
   * fired the `email:sending` hook or reached the provider.
   */
  public assertSafe(headers?: Record<string, string>): void {
    if (!headers) {
      return;
    }

    for (const name of Object.keys(headers)) {
      if (this.reserved.has(name.trim().toLowerCase())) {
        throw new EmailError(
          `Header '${name}' cannot be set on an email: it is part of the envelope, not a custom header.` +
            (name.trim().toLowerCase() === "reply-to"
              ? " Use the 'replyTo' option instead."
              : ""),
        );
      }
    }
  }
}
