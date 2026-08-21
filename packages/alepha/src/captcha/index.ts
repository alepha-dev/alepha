import { $module } from "alepha";

import { CaptchaProvider } from "./providers/CaptchaProvider.ts";
import { MemoryCaptchaProvider } from "./providers/MemoryCaptchaProvider.ts";
import { TurnstileCaptchaProvider } from "./providers/TurnstileCaptchaProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/CaptchaProvider.ts";
export * from "./providers/MemoryCaptchaProvider.ts";
export * from "./providers/TurnstileCaptchaProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Captcha verification for bot protection.
 *
 * **Features:**
 * - Provider abstraction for captcha services
 * - Cloudflare Turnstile support (free, privacy-friendly)
 * - In-memory provider for testing
 *
 * @module alepha.captcha
 */
export const AlephaCaptcha = $module({
  name: "alepha.captcha",
  services: [CaptchaProvider],
  variants: [MemoryCaptchaProvider, TurnstileCaptchaProvider],
  register: (alepha) =>
    alepha.with({
      optional: true,
      provide: CaptchaProvider,
      use: MemoryCaptchaProvider,
    }),
});
