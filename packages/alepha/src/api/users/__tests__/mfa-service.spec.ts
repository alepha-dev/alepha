import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity, CryptoProvider } from "alepha/security";
import { describe, it } from "vitest";

import {
  AlephaApiUsers,
  MfaService,
  RealmProvider,
  TotpService,
  UserService,
} from "../index.ts";

const PASSWORD = "Correct-Horse-Battery-1";

const setup = async (
  username: string,
  mfa?: { totp?: string; emailCode?: string },
) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaApiUsers);
  await alepha.start();

  const realmProvider = alepha.inject(RealmProvider);
  realmProvider.register("default", {
    settings: {
      username: "required",
      mfa: { totp: "optional", ...mfa },
    } as never,
  });

  const userService = alepha.inject(UserService);
  const crypto = alepha.inject(CryptoProvider);
  const dateTime = alepha.inject(DateTimeProvider);

  // The realm's Postgres is shared across runs; a leftover user with the same
  // name from an earlier failed run would be found first and look like a
  // missing identity.
  await realmProvider.userRepository().deleteMany({});

  const user = await userService.users().create({ username });
  await realmProvider.identityRepository().create({
    provider: "credentials",
    userId: user.id,
    password: await crypto.hashPassword(PASSWORD),
  });

  dateTime.pause();

  return {
    mfa: alepha.inject(MfaService),
    totp: alepha.inject(TotpService),
    realmProvider,
    dateTime,
    user,
  };
};

describe("alepha/api/users - MfaService", () => {
  it("should require no second factor before anyone enrolls", async ({
    expect,
  }) => {
    const ctx = await setup("mfa-none");

    expect(await ctx.mfa.methodsFor(ctx.user.id, "default")).toEqual([]);
  });

  it("should not require a second factor while enrollment is still pending", async ({
    expect,
  }) => {
    const ctx = await setup("mfa-pending");

    await ctx.mfa.beginTotpEnrollment(ctx.user.id, "default");

    // A half-finished enrollment must never gate the login: the user has not
    // proved they can produce a code yet, so requiring one locks them out.
    expect(await ctx.mfa.methodsFor(ctx.user.id, "default")).toEqual([]);
  });

  it("should require totp once enrollment is activated", async ({ expect }) => {
    const ctx = await setup("mfa-activate");

    const enrollment = await ctx.mfa.beginTotpEnrollment(
      ctx.user.id,
      "default",
    );
    const code = ctx.totp.codeForCounter(
      enrollment.secret,
      ctx.totp.currentStep(),
    );

    const { recoveryCodes } = await ctx.mfa.activateTotp(
      ctx.user.id,
      code,
      "default",
    );

    expect(await ctx.mfa.methodsFor(ctx.user.id, "default")).toEqual(["totp"]);
    expect(recoveryCodes).toHaveLength(10);
  });

  it("should refuse to activate on a code that does not match", async ({
    expect,
  }) => {
    const ctx = await setup("mfa-bad-activate");

    await ctx.mfa.beginTotpEnrollment(ctx.user.id, "default");

    await expect(
      ctx.mfa.activateTotp(ctx.user.id, "000000", "default"),
    ).rejects.toThrowError();
    expect(await ctx.mfa.methodsFor(ctx.user.id, "default")).toEqual([]);
  });

  it("should verify a valid totp code after activation", async ({ expect }) => {
    const ctx = await setup("mfa-verify");
    const enrollment = await ctx.mfa.beginTotpEnrollment(
      ctx.user.id,
      "default",
    );
    await ctx.mfa.activateTotp(
      ctx.user.id,
      ctx.totp.codeForCounter(enrollment.secret, ctx.totp.currentStep()),
      "default",
    );

    // A fresh step, so this is not the code activation just consumed.
    await ctx.dateTime.travel(30, "seconds");
    const code = ctx.totp.codeForCounter(
      enrollment.secret,
      ctx.totp.currentStep(),
    );

    expect(await ctx.mfa.verify(ctx.user.id, "totp", code, "default")).toBe(
      true,
    );
  });

  it("should refuse a totp code that was already used", async ({ expect }) => {
    const ctx = await setup("mfa-replay");
    const enrollment = await ctx.mfa.beginTotpEnrollment(
      ctx.user.id,
      "default",
    );
    await ctx.mfa.activateTotp(
      ctx.user.id,
      ctx.totp.codeForCounter(enrollment.secret, ctx.totp.currentStep()),
      "default",
    );

    await ctx.dateTime.travel(30, "seconds");
    const code = ctx.totp.codeForCounter(
      enrollment.secret,
      ctx.totp.currentStep(),
    );

    expect(await ctx.mfa.verify(ctx.user.id, "totp", code, "default")).toBe(
      true,
    );
    // Same code, same step: an attacker who shoulder-surfed it must not get
    // a second use out of it.
    expect(await ctx.mfa.verify(ctx.user.id, "totp", code, "default")).toBe(
      false,
    );
  });

  it("should consume a recovery code exactly once", async ({ expect }) => {
    const ctx = await setup("mfa-recovery");
    const enrollment = await ctx.mfa.beginTotpEnrollment(
      ctx.user.id,
      "default",
    );
    const { recoveryCodes } = await ctx.mfa.activateTotp(
      ctx.user.id,
      ctx.totp.codeForCounter(enrollment.secret, ctx.totp.currentStep()),
      "default",
    );

    const recovery = recoveryCodes[0]!;

    expect(await ctx.mfa.verify(ctx.user.id, "totp", recovery, "default")).toBe(
      true,
    );
    expect(await ctx.mfa.verify(ctx.user.id, "totp", recovery, "default")).toBe(
      false,
    );
    // The other nine survive.
    expect(
      await ctx.mfa.verify(ctx.user.id, "totp", recoveryCodes[1]!, "default"),
    ).toBe(true);
  });

  it("should stop requiring totp once it is disabled", async ({ expect }) => {
    const ctx = await setup("mfa-disable");
    const enrollment = await ctx.mfa.beginTotpEnrollment(
      ctx.user.id,
      "default",
    );
    await ctx.mfa.activateTotp(
      ctx.user.id,
      ctx.totp.codeForCounter(enrollment.secret, ctx.totp.currentStep()),
      "default",
    );

    await ctx.mfa.disableTotp(ctx.user.id, "default");

    expect(await ctx.mfa.methodsFor(ctx.user.id, "default")).toEqual([]);
  });

  it("should lock out after repeated wrong codes, even a correct one", async ({
    expect,
  }) => {
    const ctx = await setup("mfa-bruteforce");
    const enrollment = await ctx.mfa.beginTotpEnrollment(
      ctx.user.id,
      "default",
    );
    await ctx.mfa.activateTotp(
      ctx.user.id,
      ctx.totp.codeForCounter(enrollment.secret, ctx.totp.currentStep()),
      "default",
    );

    // A six-digit code is a one-in-a-million guess, which is only safe while
    // the number of guesses is bounded. The default account budget is 5.
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(
        await ctx.mfa.verify(ctx.user.id, "totp", "000000", "default"),
      ).toBe(false);
    }

    await ctx.dateTime.travel(30, "seconds");
    const good = ctx.totp.codeForCounter(
      enrollment.secret,
      ctx.totp.currentStep(),
    );

    expect(await ctx.mfa.verify(ctx.user.id, "totp", good, "default")).toBe(
      false,
    );
  });

  it("should never store the shared secret in clear text", async ({
    expect,
  }) => {
    const ctx = await setup("mfa-at-rest");
    const enrollment = await ctx.mfa.beginTotpEnrollment(
      ctx.user.id,
      "default",
    );

    const row = await ctx.realmProvider.identityRepository().findOne({
      where: { userId: { eq: ctx.user.id }, provider: { eq: "totp" } },
    });

    expect(JSON.stringify(row?.providerData)).not.toContain(enrollment.secret);
  });

  /*
   * A realm that has turned TOTP off must not hand out an enrollment.
   *
   * Without this gate the whole flow succeeds (QR, activation, ten recovery
   * codes, and an account page reading "On") while `methodsFor` returns `[]`
   * so the factor is never actually challenged at login. The user is told a
   * security control is active when it is inert, which is worse than not
   * offering it at all.
   */
  it("should refuse to start an enrollment when the realm has totp disabled", async ({
    expect,
  }) => {
    const ctx = await setup("mfa-disabled-enroll", { totp: "disabled" });

    await expect(
      ctx.mfa.beginTotpEnrollment(ctx.user.id, "default"),
    ).rejects.toThrowError();
  });

  it("should refuse to activate an enrollment started before totp was disabled", async ({
    expect,
  }) => {
    const ctx = await setup("mfa-disabled-activate");
    const enrollment = await ctx.mfa.beginTotpEnrollment(
      ctx.user.id,
      "default",
    );
    const code = ctx.totp.codeForCounter(
      enrollment.secret,
      ctx.totp.currentStep(),
    );

    // The realm turns it off while the user still has the QR on screen.
    ctx.realmProvider.register("default", {
      settings: {
        username: "required",
        mfa: { totp: "disabled" },
      } as never,
    });

    await expect(
      ctx.mfa.activateTotp(ctx.user.id, code, "default"),
    ).rejects.toThrowError();
    expect(await ctx.mfa.methodsFor(ctx.user.id, "default")).toEqual([]);
  });

  /*
   * Turning the realm setting off must never strand an existing enrollment.
   * The row survives, so `statusFor` keeps reporting it and the account page
   * can still offer to remove it. Hiding it silently would leave the user no
   * way to see or clear a factor that is no longer applied.
   */
  it("should still report an enrollment made before totp was disabled", async ({
    expect,
  }) => {
    const ctx = await setup("mfa-disabled-stranded");
    const enrollment = await ctx.mfa.beginTotpEnrollment(
      ctx.user.id,
      "default",
    );
    await ctx.mfa.activateTotp(
      ctx.user.id,
      ctx.totp.codeForCounter(enrollment.secret, ctx.totp.currentStep()),
      "default",
    );

    ctx.realmProvider.register("default", {
      settings: {
        username: "required",
        mfa: { totp: "disabled" },
      } as never,
    });

    const status = await ctx.mfa.statusFor(ctx.user.id, "default");
    expect(status.totp.enabled).toBe(true);
    expect(await ctx.mfa.methodsFor(ctx.user.id, "default")).toEqual([]);
  });

  /*
   * What an authenticator app puts under the account, and the only branding
   * a user ever sees for this realm.
   *
   * It used to be `realm.name`, which is an internal identifier: every
   * single-realm application in existence calls it `default`, so every phone
   * listed the entry as "default". Useless on its own, and actively confusing
   * once a second app does the same.
   */
  it("should label the otpauth URI with the realm's display name", async ({
    expect,
  }) => {
    const ctx = await setup("mfa-issuer");
    ctx.realmProvider.register("default", {
      settings: {
        username: "required",
        displayName: "Alepha TOTP demo",
        mfa: { totp: "optional" },
      } as never,
    });

    const { uri } = await ctx.mfa.beginTotpEnrollment(ctx.user.id, "default");

    // Spaces are percent-encoded, never "+": several authenticator apps read
    // the issuer literally and would show the plus sign.
    expect(uri).toContain("issuer=Alepha%20TOTP%20demo");
    expect(uri.startsWith("otpauth://totp/Alepha%20TOTP%20demo:")).toBe(true);
    expect(uri).not.toContain("default");
  });

  it("should fall back to the realm name when no display name is set", async ({
    expect,
  }) => {
    const ctx = await setup("mfa-issuer-fallback");

    const { uri } = await ctx.mfa.beginTotpEnrollment(ctx.user.id, "default");

    expect(uri).toContain("issuer=default");
  });

  /*
   * The escape hatch for the case above. Gating `disableTotp` on the same
   * setting as enrollment would trap a stranded user with a factor they can
   * neither use nor remove, so it stays open whatever the realm says.
   */
  it("should still let a user remove an enrollment after totp is disabled", async ({
    expect,
  }) => {
    const ctx = await setup("mfa-disabled-remove");
    const enrollment = await ctx.mfa.beginTotpEnrollment(
      ctx.user.id,
      "default",
    );
    await ctx.mfa.activateTotp(
      ctx.user.id,
      ctx.totp.codeForCounter(enrollment.secret, ctx.totp.currentStep()),
      "default",
    );

    ctx.realmProvider.register("default", {
      settings: {
        username: "required",
        mfa: { totp: "disabled" },
      } as never,
    });

    // The authenticator app still produces codes: the secret did not change.
    await ctx.dateTime.travel(30, "seconds");
    const code = ctx.totp.codeForCounter(
      enrollment.secret,
      ctx.totp.currentStep(),
    );
    expect(await ctx.mfa.verify(ctx.user.id, "totp", code, "default")).toBe(
      true,
    );

    await ctx.mfa.disableTotp(ctx.user.id, "default");

    const status = await ctx.mfa.statusFor(ctx.user.id, "default");
    expect(status.totp.enabled).toBe(false);
  });
});
