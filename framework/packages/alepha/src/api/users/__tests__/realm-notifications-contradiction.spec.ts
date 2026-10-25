import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { describe, it } from "vitest";

import { $realm, AlephaApiUsers, RealmProvider } from "../index.ts";

/**
 * A realm that requires a verification code but cannot send one is refused
 * at boot.
 *
 * `verifyEmailRequired`, `verifyPhoneRequired` and `resetPasswordAllowed`
 * all complete by delivering a code, which `features.notifications` is what
 * wires up. The combination used to be reconciled silently — `$realm`
 * overwrote all three with `false` — which meant an application could ask
 * for password resets, ship, and have every reset request rejected with
 * nothing anywhere saying why. `apps/examples/shop` did exactly that in production.
 *
 * The check lives in `RealmProvider.register` rather than `$realm`, so both
 * registration paths are held to it.
 */
describe("alepha/api/users - realm notification contradictions", () => {
  const container = async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaApiUsers);
    await alepha.start();
    return alepha.inject(RealmProvider);
  };

  const settings = [
    "verifyEmailRequired",
    "verifyPhoneRequired",
    "resetPasswordAllowed",
  ] as const;

  for (const setting of settings) {
    it(`refuses ${setting} without notifications`, async ({ expect }) => {
      const realmProvider = await container();

      expect(() =>
        realmProvider.register("contradictory", {
          settings: { [setting]: true } as never,
        }),
      ).toThrow(new RegExp(`${setting}.*features\\.notifications is off`));
    });

    it(`accepts ${setting} when notifications are on`, async ({ expect }) => {
      const realmProvider = await container();

      expect(() =>
        realmProvider.register("coherent", {
          features: { notifications: true },
          settings: { [setting]: true } as never,
        }),
      ).not.toThrow();
    });
  }

  /**
   * Only an explicit `true` contradicts. The settings atom already defaults
   * all three to `false`, so a realm that simply never mentions them — the
   * common case, and every `$realm()` written before this rule existed — is
   * untouched.
   */
  it("ignores settings left unset", async ({ expect }) => {
    const realmProvider = await container();

    expect(() => realmProvider.register("quiet", {})).not.toThrow();
    expect(() =>
      realmProvider.register("explicitly-off", {
        settings: { verifyEmailRequired: false, resetPasswordAllowed: false },
      }),
    ).not.toThrow();
  });

  /**
   * Names every offending key at once, so an application with three
   * contradictions fixes them in one pass instead of three boots.
   */
  it("names every contradicting setting in one error", async ({ expect }) => {
    const realmProvider = await container();

    expect(() =>
      realmProvider.register("all-three", {
        settings: {
          verifyEmailRequired: true,
          verifyPhoneRequired: true,
          resetPasswordAllowed: true,
        } as never,
      }),
    ).toThrow(/verifyEmailRequired, verifyPhoneRequired, resetPasswordAllowed/);
  });

  /**
   * The `$realm` path surfaces the same error. It fires while the holder
   * class is being constructed — that is, at `with()`, not at `start()` —
   * because `$realm` registers the realm from a field initializer.
   */
  it("surfaces through $realm too", async ({ expect }) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaApiUsers);

    expect(() =>
      alepha.with(() => ({
        realm: $realm({ settings: { resetPasswordAllowed: true } as never }),
      })),
    ).toThrow(/features\.notifications is off/);
  });
});
