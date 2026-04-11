/**
 * Captcha verification provider interface.
 *
 * Verifies that a user-submitted captcha token is valid. Implementations
 * call the relevant captcha service (Turnstile, reCAPTCHA, hCaptcha, etc.)
 * to validate the token server-side.
 */
export abstract class CaptchaProvider {
  /**
   * Verify a captcha token.
   *
   * @param token - The captcha response token submitted by the client.
   * @param ip - Optional client IP address for additional validation.
   * @returns Whether the token is valid.
   */
  public abstract verify(token: string, ip?: string): Promise<boolean>;
}
