import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
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
  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaApiUsers);
  await alepha.start();

  const realmProvider = alepha.inject(RealmProvider);
  realmProvider.register("default", {
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

  return {
    controller: alepha.inject(MyMfaController),
    totp: alepha.inject(TotpService),
    mfa: alepha.inject(MfaService),
    caller: { id: user.id, realm: "default" } as never,
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

    const enrollment = await ctx.controller.enrollTotp(
      {},
      { user: ctx.caller },
    );

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
    const enrollment = await ctx.controller.enrollTotp(
      {},
      { user: ctx.caller },
    );

    const result = await ctx.controller.activateTotp(
      {
        body: {
          code: ctx.totp.codeForCounter(
            enrollment.secret,
            ctx.totp.currentStep(),
          ),
        },
      },
      { user: ctx.caller },
    );

    expect(result.recoveryCodes).toHaveLength(10);
    const status = await ctx.controller.getMyMfa({}, { user: ctx.caller });
    expect(status.totp.enabled).toBe(true);
  });

  it("should refuse to disable without a valid code", async ({ expect }) => {
    const ctx = await setup("ctl-disable-guard");
    const enrollment = await ctx.controller.enrollTotp(
      {},
      { user: ctx.caller },
    );
    await ctx.controller.activateTotp(
      {
        body: {
          code: ctx.totp.codeForCounter(
            enrollment.secret,
            ctx.totp.currentStep(),
          ),
        },
      },
      { user: ctx.caller },
    );

    await expect(
      ctx.controller.disableTotp(
        { body: { code: "000000" } },
        { user: ctx.caller },
      ),
    ).rejects.toThrowError();

    // Still on: a failed disable must not half-disable anything.
    const status = await ctx.controller.getMyMfa({}, { user: ctx.caller });
    expect(status.totp.enabled).toBe(true);
  });

  it("should disable when the caller proves they still hold the device", async ({
    expect,
  }) => {
    const ctx = await setup("ctl-disable");
    const enrollment = await ctx.controller.enrollTotp(
      {},
      { user: ctx.caller },
    );
    await ctx.controller.activateTotp(
      {
        body: {
          code: ctx.totp.codeForCounter(
            enrollment.secret,
            ctx.totp.currentStep(),
          ),
        },
      },
      { user: ctx.caller },
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
    const enrollment = await ctx.controller.enrollTotp(
      {},
      { user: ctx.caller },
    );
    const first = await ctx.controller.activateTotp(
      {
        body: {
          code: ctx.totp.codeForCounter(
            enrollment.secret,
            ctx.totp.currentStep(),
          ),
        },
      },
      { user: ctx.caller },
    );

    const second = await ctx.controller.regenerateRecoveryCodes(
      {},
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
        "default",
      ),
    ).toBe(false);
  });
});
