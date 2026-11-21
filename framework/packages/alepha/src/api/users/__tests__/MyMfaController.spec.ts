import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { AlephaSecurity, CryptoProvider } from "alepha/security";
import { describe, it } from "vitest";

import {
  AlephaApiUsers,
  MfaService,
  MyMfaController,
  RealmProvider,
  TotpService,
  UserService,
} from "../index.ts";

const setup = async (username: string) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(AlephaOrmTestPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaApiUsers);
  await alepha.start();

  const realmProvider = alepha.inject(RealmProvider);
  realmProvider.register("users", {
    settings: {
      username: "required",
      mfa: { totp: "optional" },
    } as never,
  });

  await realmProvider.userRepository().deleteMany({});

  const user = await alepha.inject(UserService).users().create({ username });
  await realmProvider.identityRepository().create({
    provider: "credentials",
    userId: user.id,
    password: await alepha.inject(CryptoProvider).hashPassword("Secret-123"),
  });

  alepha.inject(DateTimeProvider).pause();
  const controller = alepha.inject(MyMfaController);

  return {
    controller,
    totp: alepha.inject(TotpService),
    mfa: alepha.inject(MfaService),
    caller: { id: user.id, realm: "users" },
    enroll: () =>
      controller.enrollTotp({}, { user: { id: user.id, realm: "users" } }),
    // Activating asks an account with a password for it.
    activate: (code: string) =>
      controller.activateTotp(
        { body: { code, proof: { currentPassword: "Secret-123" } } },
        {
          user: { id: user.id, realm: "users" },
          url: new URL("https://app.example/"),
        } as never,
      ),
    user,
  };
};

describe("alepha/api/users - MyMfaController", () => {
  it("should report nothing enrolled on a fresh account", async ({
    expect,
  }) => {
    const ctx = await setup("ctl-fresh");

    const status = await ctx.controller.getMyMfa({}, { user: ctx.caller });

    expect(status.totp.enabled).toBe(false);
    expect(status.totp.pending).toBe(false);
  });

  it("should hand out a QR code and secret when enrollment starts", async ({
    expect,
  }) => {
    const ctx = await setup("ctl-enroll");

    const enrollment = await ctx.enroll();

    expect(enrollment.uri.startsWith("otpauth://totp/")).toBe(true);
    expect(enrollment.qrSvg.startsWith("<svg")).toBe(true);
    expect(enrollment.secret).toMatch(/^[A-Z2-7]{32}$/);

    const status = await ctx.controller.getMyMfa({}, { user: ctx.caller });
    expect(status.totp.pending).toBe(true);
    expect(status.totp.enabled).toBe(false);
  });

  it("should activate on a valid code and return recovery codes once", async ({
    expect,
  }) => {
    const ctx = await setup("ctl-activate");
    const enrollment = await ctx.enroll();

    const result = await ctx.activate(
      ctx.totp.codeForCounter(enrollment.secret, ctx.totp.currentStep()),
    );

    expect(result.recoveryCodes).toHaveLength(10);
    const status = await ctx.controller.getMyMfa({}, { user: ctx.caller });
    expect(status.totp.enabled).toBe(true);
  });

  it("should refuse to disable without a valid code", async ({ expect }) => {
    const ctx = await setup("ctl-disable-guard");
    const enrollment = await ctx.enroll();
    await ctx.activate(
      ctx.totp.codeForCounter(enrollment.secret, ctx.totp.currentStep()),
    );

    await expect(
      ctx.controller.disableTotp(
        { body: { code: "000000" } },
        { user: ctx.caller },
      ),
    ).rejects.toThrow();

    // Still on: a failed disable must not half-disable anything.
    const status = await ctx.controller.getMyMfa({}, { user: ctx.caller });
    expect(status.totp.enabled).toBe(true);
  });

  it("should disable when the caller proves they still hold the device", async ({
    expect,
  }) => {
    const ctx = await setup("ctl-disable");
    const enrollment = await ctx.enroll();
    await ctx.activate(
      ctx.totp.codeForCounter(enrollment.secret, ctx.totp.currentStep()),
    );

    // A later step, because activation burned the one it used.
    await ctx.controller.disableTotp(
      {
        body: {
          code: ctx.totp.codeForCounter(
            enrollment.secret,
            ctx.totp.currentStep() + 1,
          ),
        },
      },
      { user: ctx.caller },
    );

    const status = await ctx.controller.getMyMfa({}, { user: ctx.caller });
    expect(status.totp.enabled).toBe(false);
  });

  it("should replace the recovery codes when they are regenerated", async ({
    expect,
  }) => {
    const ctx = await setup("ctl-recovery");
    const enrollment = await ctx.enroll();
    const first = await ctx.activate(
      ctx.totp.codeForCounter(enrollment.secret, ctx.totp.currentStep()),
    );

    // Proven with a recovery code of the old set, which is spent by it.
    const second = await ctx.controller.regenerateRecoveryCodes(
      { body: { code: first.recoveryCodes[1]! } },
      { user: ctx.caller },
    );

    expect(second.recoveryCodes).toHaveLength(10);
    expect(second.recoveryCodes).not.toEqual(first.recoveryCodes);
    // The old set must be dead, or regenerating would widen the attack
    // surface instead of narrowing it.
    expect(
      await ctx.mfa.verify(
        ctx.user.id,
        "totp",
        first.recoveryCodes[0]!,
        "users",
      ),
    ).toBe(false);
  });

  it("should refuse to regenerate recovery codes without a valid code (#Q2518)", async ({
    expect,
  }) => {
    const ctx = await setup("ctl-recovery-proof");
    const enrollment = await ctx.enroll();
    const first = await ctx.activate(
      ctx.totp.codeForCounter(enrollment.secret, ctx.totp.currentStep()),
    );

    await expect(
      ctx.controller.regenerateRecoveryCodes(
        { body: { code: "000000" } },
        { user: ctx.caller },
      ),
    ).rejects.toThrow();

    // The old set still works: nothing was regenerated.
    expect(
      await ctx.mfa.verify(
        ctx.user.id,
        "totp",
        first.recoveryCodes[0]!,
        "users",
      ),
    ).toBe(true);
  });
});
