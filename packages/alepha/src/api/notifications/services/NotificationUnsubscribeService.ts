import { $inject, Alepha } from "alepha";
import { CryptoProvider, SecretProvider } from "alepha/crypto";
import { $logger } from "alepha/logger";

/**
 * Mints and verifies the token behind an unsubscribe link.
 *
 * **Stateless on purpose.** There is no row per token: the claims travel in
 * the link and an HMAC proves nobody edited them. The suppression row is
 * created when someone actually uses the link, not when it is minted, which
 * matters because a link is minted for every non-critical message sent.
 *
 * **No expiry.** An unsubscribe link in a six-month-old mail must still
 * work; a link that has expired is an opt-out the recipient cannot exercise,
 * which is the thing the header exists to prevent.
 *
 * ⚠️ **Rotating `APP_SECRET` invalidates every outstanding link**, in mail
 * already delivered, with no fallback and no way to tell the recipients. It
 * is the price of not having a token table, and it is the right trade, but
 * an app that rotates secrets on a schedule needs to know before it does.
 */
export class NotificationUnsubscribeService {
  protected readonly alepha = $inject(Alepha);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly secrets = $inject(SecretProvider);
  protected readonly log = $logger();

  /**
   * Where this app is reachable from the outside.
   *
   * `PUBLIC_URL` and nothing else: the sender runs inside a job, so there is
   * no incoming request whose Host header could stand in.
   */
  protected get publicUrl(): string {
    return String(this.alepha.env.PUBLIC_URL ?? "").replace(/\/+$/, "");
  }

  /**
   * The absolute unsubscribe URL for one message, or undefined when
   * `PUBLIC_URL` is unset.
   *
   * Undefined rather than a relative path: a relative `List-Unsubscribe` is
   * worse than no header at all, because a mail client cannot resolve it and
   * some will treat the malformed header as a reason to distrust the whole
   * message.
   */
  public urlFor(claims: UnsubscribeClaims): string | undefined {
    const base = this.publicUrl;
    if (!base) {
      return undefined;
    }
    return `${base}/notifications/unsubscribe/${this.mint(claims)}`;
  }

  public mint(claims: UnsubscribeClaims): string {
    const payload = this.encode(JSON.stringify(claims));
    return `${payload}.${this.sign(payload)}`;
  }

  /**
   * Read a token's claims, or undefined if it was not minted by this app.
   *
   * Never throws: every caller is handling untrusted input from a URL, and a
   * bad token is a 400, not a crash.
   */
  public verify(token: string): UnsubscribeClaims | undefined {
    const separator = token.lastIndexOf(".");
    if (separator <= 0) {
      return undefined;
    }

    const payload = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    if (!this.crypto.verifyHmac(payload, signature, this.secrets.secretKey)) {
      return undefined;
    }

    try {
      return JSON.parse(this.decode(payload)) as UnsubscribeClaims;
    } catch {
      // A valid signature over an unparseable payload means this app minted
      // something it can no longer read. Worth a line in the log.
      this.log.warn("Unsubscribe token carries an unreadable payload");
      return undefined;
    }
  }

  protected sign(payload: string): string {
    return this.crypto.hmac(payload, this.secrets.secretKey);
  }

  /**
   * base64url, so the token drops straight into a path segment with nothing
   * to percent-encode.
   *
   * Hand-rolled rather than `Buffer`: this has to run on workerd too.
   */
  protected encode(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  protected decode(value: string): string {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
}

export interface UnsubscribeClaims {
  contact: string;
  channel: string;
  /**
   * The template's category, or absent for "everything".
   */
  category?: string;
  /**
   * The template that carried the link. Recorded so an operator can see what
   * prompted the opt-out; it does not narrow what gets suppressed.
   */
  template: string;
  /**
   * The owning tenant. On the token rather than looked up later, because the
   * route is unauthenticated and has no other way to know: a player
   * unsubscribing from one club must keep receiving the other club's mail.
   */
  organizationId?: string;
}
