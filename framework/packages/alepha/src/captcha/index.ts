import { $module } from "alepha";

import { CaptchaProvider } from "./providers/CaptchaProvider.ts";
import { MemoryCaptchaProvider } from "./providers/MemoryCaptchaProvider.ts";
import { TurnstileCaptchaProvider } from "./providers/TurnstileCaptchaProvider.ts";
import { UnconfiguredCaptchaProvider } from "./providers/UnconfiguredCaptchaProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/CaptchaProvider.ts";
export * from "./providers/MemoryCaptchaProvider.ts";
export * from "./providers/TurnstileCaptchaProvider.ts";
export * from "./providers/UnconfiguredCaptchaProvider.ts";

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
  variants: [
    MemoryCaptchaProvider,
    TurnstileCaptchaProvider,
    UnconfiguredCaptchaProvider,
  ],
  register: (alepha) =>
    // Memory only under test, the same rule AlephaEmail and AlephaSms follow.
    // It accepts EVERY token, so as a production default it turned
    // `captchaRequired: true` into captcha theatre: the setting was on, the
    // widget rendered, and any string passed. Outside test the default refuses
    // instead, and a realm that actually asked for captcha refuses to boot
    // (RealmProvider) rather than discovering this at the first signup.
    alepha.with({
      optional: true,
      provide: CaptchaProvider,
      use: alepha.isTest()
        ? MemoryCaptchaProvider
        : UnconfiguredCaptchaProvider,
    }),
});
