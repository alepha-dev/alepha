import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

import {
  AlephaApiVerification,
  VerificationParameters,
  verificationOptions,
  VerificationService,
} from "../index.ts";

const createTest = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmTestPostgres)
    .with(AlephaApiVerification);
  const parameters = alepha.inject(VerificationParameters).get("code");
  const service = alepha.inject(VerificationService);
  const dateTimeProvider = alepha.inject(DateTimeProvider);
  const target = "+33633115544";

  await alepha.start();

  return {
    alepha,
    service,
    parameters,
    dateTimeProvider,
    target,
  };
};

describe("Code Verification", () => {
  it("should verify phone with 6-digit code correctly", async ({ expect }) => {
    const { parameters, target, service } = await createTest();

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

    expect(await service.verifyCode({ type: "code", target }, code)).toEqual({
      ok: true,
    });

    expect(await service.verifyCode({ type: "code", target }, code)).toEqual({
      ok: true,
      alreadyVerified: true,
    });
  });

  it("rejects a wrong code even after the target is already verified", async ({
    expect,
  }) => {
    const { target, service } = await createTest();

    const request = await service.createVerification({ type: "code", target });

    // First, verify legitimately with the real code.
    expect(
      await service.verifyCode({ type: "code", target }, request.token),
    ).toEqual({ ok: true });

    // A bogus code submitted afterwards must NOT be accepted just because
    // the target was already verified: otherwise any flow re-using
    // verifyCode as an authz gate accepts an attacker's guess.
    await expect(() =>
      service.verifyCode({ type: "code", target }, "000000"),
    ).rejects.toThrow("Invalid verification code");

    // The real code still short-circuits as already-verified.
    expect(
      await service.verifyCode({ type: "code", target }, request.token),
    ).toEqual({ ok: true, alreadyVerified: true });
  });

  it("locks an already-verified record after too many wrong guesses", async ({
    expect,
  }) => {
    const { target, service } = await createTest();

    const request = await service.createVerification({ type: "code", target });
    await service.verifyCode({ type: "code", target }, request.token);

    // Wrong guesses against a verified record must burn the same attempt
    // budget as unverified ones: otherwise the code is brute-forceable
    // forever through this branch.
    for (let i = 0; i < request.maxVerificationAttempts; i++) {
      await expect(() =>
        service.verifyCode({ type: "code", target }, "000000"),
      ).rejects.toThrow();
    }

    await expect(() =>
      service.verifyCode({ type: "code", target }, "111111"),
    ).rejects.toThrow(/maximum|locked/i);
  });

  it("counts every one of 50 parallel wrong guesses, then refuses the right code", async ({
    expect,
  }) => {
    // Read-then-write let concurrent guesses collapse into one counted
    // attempt: 50 parallel guesses stored `attempts: 1` (#Q2507).
    const { service, parameters } = await createTest();
    const target = "+33600000050";
    const request = await service.createVerification({ type: "code", target });
    const wrong = request.token === "000000" ? "000001" : "000000";

    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        service.verifyCode({ type: "code", target }, wrong),
      ),
    );
    expect(results.every((it) => it.status === "rejected")).toBe(true);

    const verification = await service.findByEntry({ type: "code", target });
    expect(verification.attempts).toBe(parameters.maxAttempts);

    await expect(
      service.verifyCode({ type: "code", target }, request.token),
    ).rejects.toThrow("Maximum number of attempts reached");
  });

  it("does not spend the budget on right codes", async ({ expect }) => {
    // A flow that re-checks a verified code (reset, then complete) must not
    // lock the user out for having typed it right.
    const { service, parameters } = await createTest();
    const target = "+33600000051";
    const request = await service.createVerification({ type: "code", target });
    const wrong = request.token === "000000" ? "000001" : "000000";

    for (let i = 0; i < parameters.maxAttempts - 1; i++) {
      await expect(
        service.verifyCode({ type: "code", target }, wrong),
      ).rejects.toThrow("Invalid verification code");
    }
    expect(
      await service.verifyCode({ type: "code", target }, request.token),
    ).toEqual({ ok: true });
    for (let i = 0; i < 3; i++) {
      expect(
        await service.verifyCode({ type: "code", target }, request.token),
      ).toEqual({ ok: true, alreadyVerified: true });
    }

    const verification = await service.findByEntry({ type: "code", target });
    expect(verification.attempts).toBe(parameters.maxAttempts - 1);
  });

  it("should handle invalid code", async ({ expect }) => {
    const { target, service } = await createTest();

    await service.createVerification({ type: "code", target });

    await expect(() =>
      service.verifyCode({ type: "code", target }, "999999"),
    ).rejects.toThrow("Invalid verification code");
  });

  it("should handle max attempts", async ({ expect }) => {
    const { parameters, target, service } = await createTest();

    await service.createVerification({ type: "code", target });

    for (let i = 0; i < parameters.maxAttempts; i++) {
      await service
        .verifyCode({ type: "code", target }, "999999")
        .catch(() => null);
    }

    await expect(() =>
      service.verifyCode({ type: "code", target }, "999999"),
    ).rejects.toThrow("Maximum number of attempts reached");
  });

  it("should handle cooldown", async ({ expect }) => {
    const { dateTimeProvider, parameters, target, service } =
      await createTest();

    await service.createVerification({ type: "code", target });

    await expect(() =>
      service.createVerification({ type: "code", target }),
    ).rejects.toThrow("Verification is on cooldown for ");

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
    // same calendar day, running near midnight (real wall-clock) used to
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
    ).rejects.toThrow(
      `Maximum number of verification requests per day reached (${parameters.limitPerDay})`,
    );
  });

  it("should handle code expiration", async ({ expect }) => {
    const { parameters, dateTimeProvider, target, service } =
      await createTest();

    const response = await service.createVerification({ type: "code", target });

    const code = response.token;

    // Travel past expiration
    await dateTimeProvider.travel(parameters.codeExpiration + 1, "seconds");

    await expect(() =>
      service.verifyCode({ type: "code", target }, code),
    ).rejects.toThrow("Verification code has expired");
  });

  it("draws a new code for each request", async ({ expect }) => {
    const { target, service } = await createTest();

    const codes = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const response = await service.createVerification({
        type: "code",
        target: `${target}${i}`,
      });
      codes.add(response.token);
    }

    // Twelve draws out of a million landing on one value is not chance.
    expect(codes.size).toBeGreaterThan(1);
  });

  it("draws a code of the configured length", async ({ expect }) => {
    const { alepha, target, service } = await createTest();
    alepha.store.mut(verificationOptions, (old) => ({
      ...old,
      code: { ...old.code, codeLength: 9 },
    }));

    const response = await service.createVerification({ type: "code", target });

    expect(response.token).toMatch(/^\d{9}$/);
  });
});
