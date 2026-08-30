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
 * **One call site: `$email.send()`.** `04facd519`'s message said "and by the
 * notification sender"; that is wrong. `NotificationSenderService` builds its
 * headers itself and calls `emailProvider.send()` directly, which is correct
 * in substance — those headers are framework-built, never caller-set, so
 * there is nothing here to refuse — but there is no second call site to go
 * looking for.
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
   * RFC 7230 token. A header name is this or it is not a header name.
   */
  protected readonly nameToken = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

  /**
   * CR, LF and NUL. Any of them in a value ends the header and starts
   * whatever the caller wrote next, which is how a `Bcc` gets set without
   * ever being named.
   */
  protected readonly forbiddenInValue = /[\r\n\0]/;

  /**
   * Throw if the map carries a header the caller may not set.
   *
   * Three checks, and the reserved-name list alone was never enough. It stops
   * a caller who asks for `Bcc` politely; it does not stop one who smuggles
   * a whole header through a line break, which is the threat this class's own
   * doc describes. Both of these used to pass the guard completely:
   *
   * ```
   * { "X-Custom": "a\r\nBcc: attacker@example.com" }  // in the value
   * { "X-A: x\r\nBcc": "y" }                          // in the NAME, which
   * ```                                                 // lowercased is not
   *                                                     // in the reserved set
   *
   * No known live exploit today, and that is the point rather than a reason
   * to skip it: nodemailer strips newlines from values and the JSON-bodied
   * providers have no raw MIME to inject into, so the protection was coming
   * from the transports rather than from the framework that advertises it.
   * The next provider added inherits nothing from that.
   *
   * Rejected rather than stripped, consistent with the reserved-name branch
   * and for the reason it already gives: silently dropping a header would
   * send a message that is not the one that was asked for.
   *
   * Call it before anything observable happens: a refused send must not have
   * fired the `email:sending` hook or reached the provider.
   */
  public assertSafe(headers?: Record<string, string>): void {
    if (!headers) {
      return;
    }

    for (const [name, value] of Object.entries(headers)) {
      const key = name.trim().toLowerCase();

      if (this.reserved.has(key)) {
        throw new EmailError(
          `Header '${name}' cannot be set on an email: it is part of the envelope, not a custom header.` +
            (key === "reply-to" ? " Use the 'replyTo' option instead." : ""),
        );
      }

      if (!this.nameToken.test(name.trim())) {
        throw new EmailError(
          `Header name '${name}' is not a valid header name. A name carrying ':' or a line break is how a reserved header gets set without being named.`,
        );
      }

      if (typeof value === "string" && this.forbiddenInValue.test(value)) {
        throw new EmailError(
          `Header '${name}' has a value containing a line break. That ends the header and starts another one, which is header injection.`,
        );
      }
    }
  }
}
