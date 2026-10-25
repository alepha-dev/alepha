import { $context, AlephaError, z } from "alepha";
import { $logger } from "alepha/logger";

import type { CaptchaProvider } from "./CaptchaProvider.ts";

/**
 * Cloudflare Turnstile captcha verification provider.
 *
 * Validates captcha tokens against the Cloudflare Turnstile siteverify API.
 * Free, privacy-friendly, and supports invisible mode.
 *
 * ## Setup
 *
 * 1. Create a Turnstile widget at https://dash.cloudflare.com/?to=/:account/turnstile
 * 2. Copy the **Site Key** (public, for the client) and **Secret Key** (private, for the server)
 * 3. Set `TURNSTILE_SECRET_KEY` and `TURNSTILE_SITE_KEY` in your environment (both required)
 *
 * ## Client-side integration
 *
 * Add the Turnstile script and widget to your form:
 *
 * ```html
 * <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
 * <form>
 *   <div class="cf-turnstile" data-sitekey="YOUR_SITE_KEY"></div>
 *   <button type="submit">Submit</button>
 * </form>
 * ```
 *
 * The widget injects a hidden `cf-turnstile-response` input into the form.
 * Send this value as the `captchaToken` in your registration request.
 *
 * For explicit rendering (React, SPA):
 *
 * ```ts
 * turnstile.render("#container", {
 *   sitekey: "YOUR_SITE_KEY",
 *   callback: (token) => setCaptchaToken(token),
 * });
 * ```
 *
 * ## Server-side usage
 *
 * Register the provider in your app:
 *
 * ```ts
 * import { CaptchaProvider } from "alepha/captcha";
 * import { TurnstileCaptchaProvider } from "alepha/captcha";
 *
 * alepha.with({ provide: CaptchaProvider, use: TurnstileCaptchaProvider });
 * ```
 *
 * ## Test keys (for development)
 *
 * - Always passes: site `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`
 * - Always blocks: site `2x00000000000000000000AB`, secret `2x0000000000000000000000000000000AB`
 * - Forces interactive: site `3x00000000000000000000FF`
 *
 * ## Environment Variables
 *
 * - `TURNSTILE_SECRET_KEY`: The secret key from the Cloudflare Turnstile dashboard (required).
 * - `TURNSTILE_SITE_KEY`: The public site key, exposed to the client via `getSiteKey()` (required).
 * - `TURNSTILE_EXPECTED_HOSTNAME`: Refuse a token solved on any other host (optional).
 * - `TURNSTILE_EXPECTED_ACTION`: Refuse a token solved for any other widget action (optional).
 *
 * ## Pinning the hostname and the action
 *
 * A token is bound to the site it was solved on and the `action` its widget
 * declared, and siteverify reports both back. Nothing checks them unless you
 * say what to expect, so by default a token farmed from one of your pages is
 * accepted on any other - the login widget's token works against the
 * registration endpoint, and a token solved on a site sharing your secret
 * works anywhere.
 *
 * Both are opt-in because both are easy to get wrong: an app served from an
 * apex and a `www` host, or from preview deployments, has more than one valid
 * hostname, and a single mismatch refuses every registration.
 *
 * @see https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
export class TurnstileCaptchaProvider implements CaptchaProvider {
  protected readonly log = $logger();
  protected readonly secretKey: string;
  protected readonly siteKey: string;
  protected readonly expectedHostname?: string;
  protected readonly expectedAction?: string;

  /**
   * Cloudflare's verification endpoint. A field rather than a literal so a
   * spec can point it at a server it controls: everything interesting about
   * this class is how it reads siteverify's answer, and none of it was
   * reachable from a test while the URL was inlined.
   */
  protected readonly siteVerifyUrl: string =
    "https://challenges.cloudflare.com/turnstile/v0/siteverify";

  /**
   * @see CaptchaProvider.configured
   */
  public readonly configured = true;

  constructor() {
    const { alepha } = $context();

    const env = alepha.parseEnv(
      z.object({
        TURNSTILE_SECRET_KEY: z.text({
          description:
            "The secret key from the Cloudflare Turnstile dashboard.",
        }),
        TURNSTILE_SITE_KEY: z.text({
          secret: false,
          description:
            "The public site key from the Cloudflare Turnstile dashboard, rendered on the client.",
        }),
        TURNSTILE_EXPECTED_HOSTNAME: z
          .text({
            secret: false,
            description:
              "Refuse a token that was not solved on this hostname. Unset means any hostname is accepted.",
          })
          .optional(),
        TURNSTILE_EXPECTED_ACTION: z
          .text({
            secret: false,
            description:
              "Refuse a token whose widget declared a different action. Unset means any action is accepted.",
          })
          .optional(),
      }),
    );

    this.secretKey = env.TURNSTILE_SECRET_KEY;
    this.siteKey = env.TURNSTILE_SITE_KEY;
    this.expectedHostname = env.TURNSTILE_EXPECTED_HOSTNAME;
    this.expectedAction = env.TURNSTILE_EXPECTED_ACTION;
  }

  public getSiteKey(): string {
    return this.siteKey;
  }

  public async verify(token: string, ip?: string): Promise<boolean> {
    const body = new URLSearchParams();
    body.set("secret", this.secretKey);
    body.set("response", token);

    if (ip) {
      body.set("remoteip", ip);
    }

    try {
      const res = await fetch(this.siteVerifyUrl, {
        method: "POST",
        body,
      });

      // A non-2xx is not a verdict. Parsing it anyway read `success` off an
      // error page as `undefined` and returned that: the right answer for the
      // wrong reason, and one that would flip the day Cloudflare's error body
      // grew a `success` field.
      // A non-2xx is not a verdict. Parsing it anyway read `success` off an
      // error page as `undefined` and returned that: the right answer for the
      // wrong reason, and one that would flip the day Cloudflare's error body
      // grew a `success` field.
      if (!res.ok) {
        this.log.warn("Turnstile siteverify refused the request", {
          status: res.status,
        });
        return false;
      }

      const data = (await res.json()) as TurnstileResponse;

      if (!data.success) {
        this.log.debug("Turnstile verification failed", {
          errorCodes: data["error-codes"],
        });
        return false;
      }

      // A valid token still has to be OUR token. siteverify reports where it
      // was solved and for which widget action, and neither was compared
      // against anything, so a token farmed from one page was accepted on
      // every other.
      if (this.expectedHostname && data.hostname !== this.expectedHostname) {
        this.log.warn("Turnstile token solved on an unexpected hostname", {
          expected: this.expectedHostname,
          received: data.hostname,
        });
        return false;
      }

      if (this.expectedAction && data.action !== this.expectedAction) {
        this.log.warn("Turnstile token solved for an unexpected action", {
          expected: this.expectedAction,
          received: data.action,
        });
        return false;
      }

      return true;
    } catch (error) {
      throw new AlephaError("Failed to verify Turnstile captcha token", {
        cause: error,
      });
    }
  }
}

interface TurnstileResponse {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
}
