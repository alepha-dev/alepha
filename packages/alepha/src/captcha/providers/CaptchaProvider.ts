/**
 * Captcha verification provider interface.
 *
 * Verifies that a user-submitted captcha token is valid. Implementations
 * call the relevant captcha service (Turnstile, reCAPTCHA, hCaptcha, etc.)
 * to validate the token server-side.
 */
export abstract class CaptchaProvider {
  /**
   * Whether this provider can actually verify a token against a service.
   *
   * `false` only for {@link UnconfiguredCaptchaProvider}, the fail-closed
   * stand-in bound when the app registered no provider. Anything that turns
   * captcha ON reads this to refuse at boot rather than discover at the first
   * registration that the protection was never there.
   */
  public readonly configured: boolean = true;

  /**
   * Verify a captcha token.
   *
   * @param token - The captcha response token submitted by the client.
   * @param ip - Optional client IP address for additional validation.
   * @returns Whether the token is valid.
   */
  public abstract verify(token: string, ip?: string): Promise<boolean>;

  /**
   * Public site/widget key to hand to the browser, when applicable.
   *
   * Returns `undefined` for providers that don't need a client key
   * (e.g. in-memory/test providers).
   */
  public getSiteKey(): string | undefined {
    return undefined;
  }
}
