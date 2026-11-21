import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

import {
  AlephaApiVerification,
  VerificationParameters,
  VerificationService,
} from "../index.ts";

const createTest = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmTestPostgres)
    .with(AlephaApiVerification);
  const parameters = alepha.inject(VerificationParameters).get("link");
  const service = alepha.inject(VerificationService);
  const dateTimeProvider = alepha.inject(DateTimeProvider);
  const target = "test@example.com";

  await alepha.start();

  return {
    alepha,
    service,
    parameters,
    dateTimeProvider,
    target,
  };
};

describe("Link Verification", () => {
  it("should verify link with UUID token correctly", async ({ expect }) => {
    const { parameters, target, service } = await createTest();

    const request = await service.createVerification({ type: "link", target });

    expect(request.codeExpiration).toEqual(parameters.codeExpiration);
    expect(request.verificationCooldown).toEqual(
      parameters.verificationCooldown,
    );
    expect(request.maxVerificationAttempts).toEqual(parameters.maxAttempts);
    expect(request.token).toBeTruthy();

    // UUID format validation
    const token = request.token;
    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    expect(await service.verifyCode({ type: "link", target }, token)).toEqual({
      ok: true,
    });

    expect(await service.verifyCode({ type: "link", target }, token)).toEqual({
      ok: true,
      alreadyVerified: true,
    });
  });

  it("should handle invalid token", async ({ expect }) => {
    const { target, service } = await createTest();

    await service.createVerification({ type: "link", target });

    await expect(() =>
      service.verifyCode(
        { type: "link", target },
        "550e8400-e29b-41d4-a716-446655440000",
      ),
    ).rejects.toThrow("Invalid verification code");
  });

  it("should handle max attempts", async ({ expect }) => {
    const { parameters, target, service } = await createTest();

    await service.createVerification({ type: "link", target });

    for (let i = 0; i < parameters.maxAttempts; i++) {
      await service
        .verifyCode(
          { type: "link", target },
          "550e8400-e29b-41d4-a716-446655440000",
        )
        .catch(() => null);
    }

    await expect(() =>
      service.verifyCode(
        { type: "link", target },
        "550e8400-e29b-41d4-a716-446655440000",
      ),
    ).rejects.toThrow("Maximum number of attempts reached");
  });

  it("should handle cooldown", async ({ expect }) => {
    const { dateTimeProvider, parameters, target, service } =
      await createTest();

    await service.createVerification({ type: "link", target });

    await expect(() =>
      service.createVerification({ type: "link", target }),
    ).rejects.toThrow("Verification is on cooldown for ");

    await dateTimeProvider.travel(
      parameters.verificationCooldown + 1,
      "seconds",
    );

    const response = await service.createVerification({ type: "link", target });

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
      await service.createVerification({ type: "link", target });
      await dateTimeProvider.travel(
        parameters.verificationCooldown + 1,
        "seconds",
      );
    }

    await expect(() =>
      service.createVerification({ type: "link", target }),
    ).rejects.toThrow(
      `Maximum number of verification requests per day reached (${parameters.limitPerDay})`,
    );
  });

  it("should handle token expiration", async ({ expect }) => {
    const { parameters, dateTimeProvider, target, service } =
      await createTest();

    const response = await service.createVerification({ type: "link", target });

    const token = response.token;

    // Travel past expiration
    await dateTimeProvider.travel(parameters.codeExpiration + 1, "seconds");

    await expect(() =>
      service.verifyCode({ type: "link", target }, token),
    ).rejects.toThrow("Verification code has expired");
  });

  it("reports the entry's own lifetime when it was created with one", async ({
    expect,
  }) => {
    const { dateTimeProvider, target, service } = await createTest();
    dateTimeProvider.pause();

    const response = await service.createVerification({
      type: "link",
      target,
      purpose: "invitation:1",
      expiresAt: dateTimeProvider.now().add(7, "days").toISOString(),
    });

    expect(response.codeExpiration).toBe(7 * 24 * 60 * 60);
  });

  it("refuses a verified token once it has expired", async ({ expect }) => {
    const { parameters, dateTimeProvider, target, service } =
      await createTest();
    const { token } = await service.createVerification({
      type: "link",
      target,
    });
    await service.verifyCode({ type: "link", target }, token);

    await dateTimeProvider.travel(parameters.codeExpiration + 1, "seconds");

    await expect(() =>
      service.verifyCode({ type: "link", target }, token),
    ).rejects.toThrow("Verification code has expired");
  });
});
