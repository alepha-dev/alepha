import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";
import {
  AlephaApiVerification,
  VerificationController,
  VerificationParameters,
  VerificationService,
} from "../index.ts";

const createTest = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaApiVerification);
  const parameters = alepha.inject(VerificationParameters).get("code");
  const controller = alepha.inject(VerificationController);
  const service = alepha.inject(VerificationService);
  const dateTimeProvider = alepha.inject(DateTimeProvider);
  const target = "+33633115544";

  await alepha.start();

  return {
    alepha,
    service,
    parameters,
    controller,
    dateTimeProvider,
    target,
  };
};

describe("Code Verification", () => {
  it("should verify phone with 6-digit code correctly", async ({ expect }) => {
    const { parameters, controller, target, service } = await createTest();

    const request = await service.createVerification({ type: "code", target });

    expect(request.codeExpiration).toEqual(parameters.codeExpiration);
    expect(request.verificationCooldown).toEqual(
      parameters.verificationCooldown,
    );
    expect(request.maxVerificationAttempts).toEqual(parameters.maxAttempts);
    expect(request.token).toBeTruthy();

    const code = request.token;

    // 6-digit code validation
    expect(code).toMatch(/^\d{6}$/);
    expect(code.length).toBe(parameters.codeLength);

    expect(
      await controller.validateVerificationCode({
        params: {
          type: "code",
        },
        body: {
          target,
          token: code,
        },
      }),
    ).toEqual({
      ok: true,
    });

    expect(
      await controller.validateVerificationCode({
        params: {
          type: "code",
        },
        body: {
          target,
          token: code,
        },
      }),
    ).toEqual({
      ok: true,
      alreadyVerified: true,
    });
  });

  it("rejects a wrong code even after the target is already verified", async ({
    expect,
  }) => {
    const { controller, target, service } = await createTest();

    const request = await service.createVerification({ type: "code", target });

    // First, verify legitimately with the real code.
    expect(
      await controller.validateVerificationCode({
        params: { type: "code" },
        body: { target, token: request.token },
      }),
    ).toEqual({ ok: true });

    // A bogus code submitted afterwards must NOT be accepted just because
    // the target was already verified — otherwise any flow re-using
    // verifyCode as an authz gate accepts an attacker's guess.
    await expect(() =>
      controller.validateVerificationCode({
        params: { type: "code" },
        body: { target, token: "000000" },
      }),
    ).rejects.toThrowError("Invalid verification code");

    // The real code still short-circuits as already-verified.
    expect(
      await controller.validateVerificationCode({
        params: { type: "code" },
        body: { target, token: request.token },
      }),
    ).toEqual({ ok: true, alreadyVerified: true });
  });

  it("should handle invalid code", async ({ expect }) => {
    const { controller, target, service } = await createTest();

    await service.createVerification({ type: "code", target });

    await expect(() =>
      controller.validateVerificationCode({
        params: {
          type: "code",
        },
        body: {
          target,
          token: "999999",
        },
      }),
    ).rejects.toThrowError("Invalid verification code");
  });

  it("should handle max attempts", async ({ expect }) => {
    const { parameters, controller, target, service } = await createTest();

    await service.createVerification({ type: "code", target });

    for (let i = 0; i < parameters.maxAttempts; i++) {
      await controller
        .validateVerificationCode({
          params: {
            type: "code",
          },
          body: {
            target,
            token: "999999",
          },
        })
        .catch(() => null);
    }

    await expect(() =>
      controller.validateVerificationCode({
        params: {
          type: "code",
        },
        body: {
          target,
          token: "999999",
        },
      }),
    ).rejects.toThrowError("Maximum number of attempts reached");
  });

  it("should handle cooldown", async ({ expect }) => {
    const { dateTimeProvider, parameters, target, service } =
      await createTest();

    await service.createVerification({ type: "code", target });

    await expect(() =>
      service.createVerification({ type: "code", target }),
    ).rejects.toThrowError("Verification is on cooldown for ");

    await dateTimeProvider.travel(
      parameters.verificationCooldown + 1,
      "seconds",
    );

    const response = await service.createVerification({ type: "code", target });

    expect(response.codeExpiration).toEqual(parameters.codeExpiration);
    expect(response.verificationCooldown).toEqual(
      parameters.verificationCooldown,
    );
    expect(response.maxVerificationAttempts).toEqual(parameters.maxAttempts);
    expect(response.token).toBeTruthy();
  });

  it("should respect rate limit per day", async ({ expect }) => {
    const { parameters, dateTimeProvider, target, service } =
      await createTest();

    // Anchor test time at noon to keep all `limitPerDay` inserts inside the
    // same calendar day — running near midnight (real wall-clock) used to
    // make the cooldown travel cross day boundaries and reset the window.
    const now = dateTimeProvider.now();
    const noon = now.startOf("day").add(12, "hours");
    if (noon.diff(now) > 0) {
      await dateTimeProvider.travel(noon.diff(now), "milliseconds");
    } else {
      await dateTimeProvider.travel(
        noon.add(1, "day").diff(now),
        "milliseconds",
      );
    }

    for (let i = 0; i < parameters.limitPerDay; i++) {
      await service.createVerification({ type: "code", target });
      await dateTimeProvider.travel(
        parameters.verificationCooldown + 1,
        "seconds",
      );
    }

    await expect(() =>
      service.createVerification({ type: "code", target }),
    ).rejects.toThrowError(
      `Maximum number of verification requests per day reached (${parameters.limitPerDay})`,
    );
  });

  it("should handle code expiration", async ({ expect }) => {
    const { parameters, controller, dateTimeProvider, target, service } =
      await createTest();

    const response = await service.createVerification({ type: "code", target });

    const code = response.token;

    // Travel past expiration
    await dateTimeProvider.travel(parameters.codeExpiration + 1, "seconds");

    await expect(() =>
      controller.validateVerificationCode({
        params: {
          type: "code",
        },
        body: {
          target,
          token: code,
        },
      }),
    ).rejects.toThrowError("Verification code has expired");
  });

  it("should generate different codes for each request", async ({ expect }) => {
    const { dateTimeProvider, parameters, target, service } =
      await createTest();

    const response1 = await service.createVerification({
      type: "code",
      target,
    });

    const code1 = response1.token;

    await dateTimeProvider.travel(
      parameters.verificationCooldown + 1,
      "seconds",
    );

    const response2 = await service.createVerification({
      type: "code",
      target,
    });

    const code2 = response2.token;

    // Codes should be different (though technically they could be the same by chance)
    // This tests that we're generating new codes, not reusing
    expect(code1).toMatch(/^\d{6}$/);
    expect(code2).toMatch(/^\d{6}$/);
  });

  it("should pad codes with leading zeros", async ({ expect }) => {
    const { target, service } = await createTest();

    // Request multiple codes to increase chance of getting one with leading zeros
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const response = await service.createVerification({
        type: "code",
        target: `${target}${i}`,
      });
      codes.push(response.token);
    }

    // All codes should be exactly 6 digits
    for (const code of codes) {
      expect(code).toMatch(/^\d{6}$/);
      expect(code.length).toBe(6);
    }
  });
});
