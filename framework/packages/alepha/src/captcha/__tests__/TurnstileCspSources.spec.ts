import { Alepha } from "alepha";
import {
  AlephaServer,
  helmetOptions,
  ServerHelmetProvider,
} from "alepha/server";
import { describe, it } from "vitest";

import {
  AlephaCaptcha,
  CaptchaProvider,
  TurnstileCaptchaProvider,
} from "../index.ts";

/**
 * Turnstile's host joins the policy when Turnstile is the configured
 * captcha, and only then (#Q3358).
 */
describe("TurnstileCaptchaProvider CSP sources", () => {
  const app = (env: Record<string, string> = {}, turnstile = false) => {
    let alepha = Alepha.create({ env: { LOG_LEVEL: "silent", ...env } });
    if (turnstile) {
      // Substituted before the module that resolves it.
      alepha = alepha.with({
        provide: CaptchaProvider,
        use: TurnstileCaptchaProvider,
      });
    }
    alepha = alepha.with(AlephaServer).with(AlephaCaptcha);
    alepha.store.mut(helmetOptions, (old) => ({
      ...old,
      contentSecurityPolicy: {},
    }));
    return alepha;
  };

  const policy = (alepha: Alepha) =>
    alepha.inject(ServerHelmetProvider).getHeaders()[
      "content-security-policy"
    ] ?? "";

  it("adds the widget's script-src and frame-src when Turnstile is configured", ({
    expect,
  }) => {
    const alepha = app(
      {
        TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
        TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      },
      true,
    );
    alepha.inject(CaptchaProvider);

    const value = policy(alepha);
    expect(value).toContain(
      "script-src 'self' https://challenges.cloudflare.com",
    );
    expect(value).toContain(
      "frame-src 'self' https://challenges.cloudflare.com",
    );
  });

  it("adds nothing when the captcha is not Turnstile", ({ expect }) => {
    const alepha = app();
    alepha.inject(CaptchaProvider);

    expect(policy(alepha)).not.toContain("challenges.cloudflare.com");
  });
});
