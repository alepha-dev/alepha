import { Alepha } from "alepha";
import {
  CaptchaProvider,
  MemoryCaptchaProvider,
  UnconfiguredCaptchaProvider,
} from "alepha/captcha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { describe, it } from "vitest";

import { AlephaApiUsers, RealmProvider } from "../index.ts";

/**
 * A realm that requires a captcha nothing can verify is refused at boot.
 *
 * The old default was `MemoryCaptchaProvider` in EVERY environment, and it
 * accepts every token — so `captchaRequired: true` with no provider bound was
 * captcha theatre: the setting on, the widget rendered, and any string
 * accepted. The default outside test now refuses instead, which makes the
 * contradiction worth catching at boot rather than at the first signup.
 *
 * Which provider is the default in which environment is pinned separately, in
 * `captcha/__tests__/UnconfiguredCaptchaProvider.spec.ts`. Here the provider
 * is substituted explicitly, so this stays a test about the realm check and
 * not about `NODE_ENV`.
 *
 * Same home as the notifications contradiction (`RealmProvider.register`), so
 * both registration paths are held to it.
 */
describe("alepha/api/users - realm captcha provider", () => {
  const container = async (captcha: typeof CaptchaProvider) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    // Before anything resolves it — the container refuses a late substitution.
    alepha.with({ provide: CaptchaProvider, use: captcha });
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaApiUsers);
    await alepha.start();
    return alepha.inject(RealmProvider);
  };

  it("refuses captchaRequired when no provider is registered", async ({
    expect,
  }) => {
    const realmProvider = await container(UnconfiguredCaptchaProvider as never);

    expect(() =>
      realmProvider.register("gated", {
        settings: { captchaRequired: true } as never,
      }),
    ).toThrow(/captchaRequired but no CaptchaProvider is registered/);
  });

  it("accepts captchaRequired when a provider is registered", async ({
    expect,
  }) => {
    const realmProvider = await container(MemoryCaptchaProvider as never);

    expect(() =>
      realmProvider.register("gated", {
        settings: { captchaRequired: true } as never,
      }),
    ).not.toThrow();
  });

  it("says nothing when captcha is not required", async ({ expect }) => {
    const realmProvider = await container(UnconfiguredCaptchaProvider as never);

    // Registering `alepha/captcha` without ever requiring a captcha is not a
    // misconfiguration, so this must still start.
    expect(() => realmProvider.register("open", {})).not.toThrow();
  });
});
