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
});
