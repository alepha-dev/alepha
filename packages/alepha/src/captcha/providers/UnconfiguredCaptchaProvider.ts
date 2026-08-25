import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";

import type { CaptchaProvider } from "./CaptchaProvider.ts";

/**
 * The captcha provider an app gets when it registered none.
 *
 * Refuses every token. That is the whole point: the default used to be
 * {@link MemoryCaptchaProvider}, which accepts every token, in every
 * environment — so a realm with `captchaRequired: true` and no provider bound
 * had captcha "on" and no captcha at all, and nothing said so. A protection
 * that is absent must refuse, not wave through.
 *
 * The refusal is loud rather than silent: `verify()` logs an error naming what
 * to bind. Boot-time refusal is separate and lives with the code that knows a
 * realm asked for captcha (`RealmProvider`), because a container that merely
 * registered `alepha/captcha` without ever requiring a captcha is not
 * misconfigured and must still start.
 *
 * @see TurnstileCaptchaProvider
 */
export class UnconfiguredCaptchaProvider implements CaptchaProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);

  /**
   * @see CaptchaProvider.configured
   */
  public readonly configured = false;

  public getSiteKey(): string | undefined {
    return undefined;
  }

  public async verify(): Promise<boolean> {
    this.log.error(
      "Captcha verification was requested but no CaptchaProvider is registered, " +
        "so the token is refused. Bind a real provider, e.g. " +
        "alepha.with({ provide: CaptchaProvider, use: TurnstileCaptchaProvider }) " +
        "with TURNSTILE_SECRET_KEY and TURNSTILE_SITE_KEY set.",
    );

    return false;
  }
}
