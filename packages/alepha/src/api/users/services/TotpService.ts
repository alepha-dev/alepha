import { createHmac, randomBytes } from "node:crypto";

import { $inject, AlephaError } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { renderSVG } from "uqr";

/**
 * Time-based one-time passwords, as specified by RFC 6238 on top of the
 * HOTP construction of RFC 4226.
 *
 * Deliberately built on `node:crypto` rather than {@link CryptoProvider}:
 * `CryptoProvider.hmac` takes and returns strings, and TOTP needs a binary
 * key and a binary counter. `ServerCookiesProvider` reaches for `node:crypto`
 * the same way. Cloudflare Workers get it through `nodejs_compat`.
 */
export class TotpService {
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly crypto = $inject(CryptoProvider);

  /**
   * RFC 4648 base32 alphabet. TOTP secrets are exchanged in base32 because
   * that is what authenticator apps and `otpauth://` URIs speak.
   */
  protected static readonly BASE32_ALPHABET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  /**
   * Number of digits shown to the user. Six is what every authenticator app
   * defaults to, and the `otpauth://` URI advertises it explicitly anyway.
   */
  protected static readonly DIGITS = 6;

  /**
   * Length of a time step in seconds. RFC 6238 recommends 30, and every
   * authenticator app assumes it.
   */
  protected static readonly PERIOD_SECONDS = 30;

  /**
   * How many steps either side of the current one are accepted, to absorb
   * clock drift between the server and the user's phone. One step means a
   * code stays usable for at most 90 seconds.
   */
  protected static readonly WINDOW_STEPS = 1;

  /**
   * The time step the clock is currently in.
   *
   * Reads {@link DateTimeProvider}, never `Date.now()`, so tests can drive it
   * with `travel()`.
   */
  public currentStep(): number {
    return Math.floor(
      this.dateTime.nowMillis() / 1000 / TotpService.PERIOD_SECONDS,
    );
  }

  /**
   * Check a user-supplied code against the accepted window.
   *
   * Returns the step that matched, so the caller can persist it and refuse
   * to accept that same step twice. Returns `undefined` when nothing in the
   * window matches.
   */
  public verify(secret: string, code: string): number | undefined {
    const submitted = code.replace(/\s/g, "");
    if (!/^\d+$/.test(submitted)) {
      return undefined;
    }

    const current = this.currentStep();

    for (
      let offset = -TotpService.WINDOW_STEPS;
      offset <= TotpService.WINDOW_STEPS;
      offset++
    ) {
      const step = current + offset;
      if (this.crypto.equals(this.codeForCounter(secret, step), submitted)) {
        return step;
      }
    }

    return undefined;
  }

  /**
   * Generate a fresh shared secret, base32 encoded.
   *
   * 160 bits, the RFC 4226 recommendation, which is also the length every
   * authenticator app is happiest with.
   */
  public generateSecret(): string {
    return this.encodeBase32(randomBytes(20));
  }

  /**
   * Build the `otpauth://` URI that goes into the enrollment QR code.
   *
   * Follows the Key URI format. The parameters are spelled out rather than
   * left to defaults because a few authenticator apps do not apply the
   * documented defaults.
   */
  public otpauthUri(options: {
    secret: string;
    account: string;
    issuer: string;
  }): string {
    const label = `${encodeURIComponent(options.issuer)}:${encodeURIComponent(options.account)}`;

    // Built by hand rather than with URLSearchParams: that encodes a space
    // as "+", and several authenticator apps read the issuer literally.
    const query = [
      `secret=${encodeURIComponent(options.secret)}`,
      `issuer=${encodeURIComponent(options.issuer)}`,
      "algorithm=SHA1",
      `digits=${TotpService.DIGITS}`,
      `period=${TotpService.PERIOD_SECONDS}`,
    ].join("&");

    return `otpauth://totp/${label}?${query}`;
  }

  /**
   * Render an enrollment URI as an inline SVG QR code.
   *
   * Rendered on the server so that no downstream application has to ship a
   * QR encoder of its own, and so that an app with a hand-rolled login page
   * gets the same enrollment UX as one using `@alepha/ui`.
   */
  public qrSvg(data: string): string {
    return renderSVG(data, { border: 1 });
  }

  /**
   * Derive the code for an explicit counter.
   *
   * The counter is kept out of the clock on purpose: it is what makes the
   * RFC 6238 reference vectors testable, and what lets the verifier walk a
   * window of steps without moving time.
   */
  public codeForCounter(secret: string, counter: number): string {
    const key = this.decodeBase32(secret);

    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(BigInt(counter));

    const digest = createHmac("sha1", key).update(message).digest();

    // RFC 4226 dynamic truncation: the low nibble of the last byte picks the
    // offset of the 4 bytes that carry the code.
    const offset = digest[digest.length - 1]! & 0x0f;
    const binary =
      ((digest[offset]! & 0x7f) << 24) |
      ((digest[offset + 1]! & 0xff) << 16) |
      ((digest[offset + 2]! & 0xff) << 8) |
      (digest[offset + 3]! & 0xff);

    const code = binary % 10 ** TotpService.DIGITS;
    return code.toString().padStart(TotpService.DIGITS, "0");
  }

  /**
   * Encode raw bytes as unpadded RFC 4648 base32.
   *
   * Unpadded because the Key URI format has no use for the padding and
   * authenticator apps display the secret for manual entry.
   */
  protected encodeBase32(input: Buffer): string {
    let bits = 0;
    let value = 0;
    let output = "";

    for (const byte of input) {
      value = (value << 8) | byte;
      bits += 8;

      while (bits >= 5) {
        output += TotpService.BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
        bits -= 5;
      }
    }

    if (bits > 0) {
      output += TotpService.BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
    }

    return output;
  }

  /**
   * Decode an RFC 4648 base32 secret into the raw key bytes.
   *
   * Padding and casing are tolerated because users paste these by hand, and
   * spaces are stripped for the same reason: authenticator apps display the
   * secret in groups of four.
   */
  protected decodeBase32(secret: string): Buffer {
    const normalized = secret
      .replace(/[\s-]/g, "")
      .replace(/=+$/, "")
      .toUpperCase();

    if (!normalized) {
      throw new AlephaError("TOTP secret is empty");
    }

    const bytes: number[] = [];
    let bits = 0;
    let value = 0;

    for (const char of normalized) {
      const index = TotpService.BASE32_ALPHABET.indexOf(char);
      if (index === -1) {
        throw new AlephaError(`Invalid base32 character in TOTP secret`);
      }

      value = (value << 5) | index;
      bits += 5;

      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }

    return Buffer.from(bytes);
  }
}
