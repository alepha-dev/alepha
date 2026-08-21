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
 *
 * @see https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
export class TurnstileCaptchaProvider implements CaptchaProvider {
  protected readonly log = $logger();
  protected readonly secretKey: string;
  protected readonly siteKey: string;

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
      }),
    );

    this.secretKey = env.TURNSTILE_SECRET_KEY;
    this.siteKey = env.TURNSTILE_SITE_KEY;
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
      const res = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          body,
        },
      );

      const data = (await res.json()) as TurnstileResponse;

      if (!data.success) {
        this.log.debug("Turnstile verification failed", {
          errorCodes: data["error-codes"],
        });
      }

      return data.success;
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
