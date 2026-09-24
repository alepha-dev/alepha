import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import {
  AlephaSecurity,
  CryptoProvider,
  InvalidCredentialsError,
} from "alepha/security";
import { describe, it } from "vitest";

import {
  AlephaApiUsers,
  MfaService,
  RealmProvider,
  SessionService,
  UserService,
} from "../index.ts";

/**
 * Counts how many passwords were actually compared, and slows each compare
 * down so a burst of logins overlaps the way concurrent requests do.
 */
class CountingCryptoProvider extends CryptoProvider {
  public compares = 0;

  public override async verifyPassword(
    password: string,
    stored: string,
  ): Promise<boolean> {
    this.compares += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return super.verifyPassword(password, stored);
  }
}

/**
 * Counts how many second-factor codes were actually checked.
 */
class CountingMfaService extends MfaService {
  public checks = 0;

  protected override async verifyTotp(): Promise<boolean> {
    this.checks += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return false;
  }
}

/**
 * #Q2529: the login and MFA counters were read before the compare and
 * incremented after a failure, so a burst of parallel guesses all read the
 * counter under the cap and each got a compare. They take their slot first
 * now: however wide the burst, no more than the cap is ever compared.
 */
describe("attempt budgets under a burst", () => {
  const setup = async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with({ provide: CryptoProvider, use: CountingCryptoProvider });
    alepha.with({ provide: MfaService, use: CountingMfaService });
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaApiUsers);
    await alepha.start();

    const email = `burst-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const crypt = alepha.inject(CryptoProvider) as CountingCryptoProvider;
    const user = await alepha
      .inject(UserService)
      .users()
      .create({ email, roles: ["user"] });
    await alepha
      .inject(SessionService)
      .identities()
      .create({
        provider: "local",
        providerUserId: email,
        userId: user.id,
        password: await crypt.hashPassword("correct"),
      });
    const settings = await alepha
      .inject(RealmProvider)
      .getRealm()
      .getSettings();

    return {
      alepha,
      crypt,
      email,
      user,
      max: settings.loginRateLimit.accountMaxAttempts,
      sessions: alepha.inject(SessionService),
      mfa: alepha.inject(MfaService) as CountingMfaService,
    };
  };

  it("compares no more passwords than the account cap, then refuses the right one", async ({
    expect,
  }) => {
    const ctx = await setup();

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        ctx.sessions.login("local", ctx.email, "wrong"),
      ),
    );
    expect(results.every((it) => it.status === "rejected")).toBe(true);
    expect(ctx.crypt.compares).toBeLessThanOrEqual(ctx.max);

    const before = ctx.crypt.compares;
    await expect(
      ctx.sessions.login("local", ctx.email, "correct"),
    ).rejects.toThrow(InvalidCredentialsError);
    // Refused before the compare, not by it.
    expect(ctx.crypt.compares).toBe(before);
  });

  it("gives the slot back on a right password", async ({ expect }) => {
    const ctx = await setup();

    for (let i = 0; i < ctx.max + 2; i++) {
      await ctx.sessions.login("local", ctx.email, "correct");
    }
    // Successes spent nothing: the wrong guesses still have the full budget.
    for (let i = 0; i < ctx.max - 1; i++) {
      await expect(
        ctx.sessions.login("local", ctx.email, "wrong"),
      ).rejects.toThrow(InvalidCredentialsError);
    }
    expect((await ctx.sessions.login("local", ctx.email, "correct")).id).toBe(
      ctx.user.id,
    );
  });

  it("checks no more second-factor codes than the cap", async ({ expect }) => {
    const ctx = await setup();

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        ctx.mfa.verify(ctx.user.id, "totp", "000000"),
      ),
    );
    expect(results.every((passed) => passed === false)).toBe(true);
    expect(ctx.mfa.checks).toBeLessThanOrEqual(ctx.max);
  });
});
