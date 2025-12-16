import { Alepha } from "alepha";
import {
  AlephaApiVerification,
  VerificationController,
  VerificationParameters,
} from "alepha/api/verifications";
import { DateTimeProvider } from "alepha/datetime";
import { describe, it } from "vitest";

const createTest = async () => {
  const alepha = Alepha.create().with(AlephaApiVerification);
  const parameters = alepha.inject(VerificationParameters).get("link");
  const controller = alepha.inject(VerificationController);
  const dateTimeProvider = alepha.inject(DateTimeProvider);
  const target = "test@example.com";

  await alepha.start();

  return {
    alepha,
    parameters,
    controller,
    dateTimeProvider,
    target,
  };
};

describe("Link Verification", () => {
  it("should verify link with UUID token correctly", async ({ expect }) => {
    const { parameters, controller, target } = await createTest();

    const request = await controller.requestVerificationCode({
      params: {
        type: "link",
      },
      body: {
        target,
      },
    });

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

    expect(
      await controller.validateVerificationCode({
        params: {
          type: "link",
        },
        body: {
          target,
          token,
        },
      }),
    ).toEqual({
      ok: true,
    });

    expect(
      await controller.validateVerificationCode({
        params: {
          type: "link",
        },
        body: {
          target,
          token,
        },
      }),
    ).toEqual({
      ok: true,
      alreadyVerified: true,
    });
  });

  it("should handle invalid token", async ({ expect }) => {
    const { controller, target } = await createTest();

    await controller.requestVerificationCode({
      params: {
        type: "link",
      },
      body: {
        target,
      },
    });

    await expect(() =>
      controller.validateVerificationCode({
        params: {
          type: "link",
        },
        body: {
          target,
          token: "550e8400-e29b-41d4-a716-446655440000",
        },
      }),
    ).rejects.toThrowError("Invalid verification code");
  });

  it("should handle max attempts", async ({ expect }) => {
    const { parameters, controller, target } = await createTest();

    await controller.requestVerificationCode({
      params: {
        type: "link",
      },
      body: {
        target,
      },
    });

    for (let i = 0; i < parameters.maxAttempts; i++) {
      await controller
        .validateVerificationCode({
          params: {
            type: "link",
          },
          body: {
            target,
            token: "550e8400-e29b-41d4-a716-446655440000",
          },
        })
        .catch(() => null);
    }

    await expect(() =>
      controller.validateVerificationCode({
        params: {
          type: "link",
        },
        body: {
          target,
          token: "550e8400-e29b-41d4-a716-446655440000",
        },
      }),
    ).rejects.toThrowError("Maximum number of attempts reached");
  });

  it("should handle cooldown", async ({ expect }) => {
    const { dateTimeProvider, parameters, controller, target } =
      await createTest();

    await controller.requestVerificationCode({
      params: {
        type: "link",
      },
      body: {
        target,
      },
    });

    await expect(() =>
      controller.requestVerificationCode({
        params: {
          type: "link",
        },
        body: {
          target,
        },
      }),
    ).rejects.toThrowError("Verification is on cooldown for ");

    await dateTimeProvider.travel(
      parameters.verificationCooldown + 1,
      "seconds",
    );

    const response = await controller.requestVerificationCode({
      params: {
        type: "link",
      },
      body: {
        target,
      },
    });

    expect(response.codeExpiration).toEqual(parameters.codeExpiration);
    expect(response.verificationCooldown).toEqual(
      parameters.verificationCooldown,
    );
    expect(response.maxVerificationAttempts).toEqual(parameters.maxAttempts);
    expect(response.token).toBeTruthy();
  });

  it("should respect rate limit per day", async ({ expect }) => {
    const { parameters, controller, dateTimeProvider, target } =
      await createTest();

    for (let i = 0; i < parameters.limitPerDay; i++) {
      await controller.requestVerificationCode({
        params: {
          type: "link",
        },
        body: {
          target,
        },
      });
      await dateTimeProvider.travel(
        parameters.verificationCooldown + 1,
        "seconds",
      );
    }

    await expect(() =>
      controller.requestVerificationCode({
        params: {
          type: "link",
        },
        body: {
          target,
        },
      }),
    ).rejects.toThrowError(
      `Maximum number of verification requests per day reached (${parameters.limitPerDay})`,
    );
  });

  it("should handle token expiration", async ({ expect }) => {
    const { parameters, controller, dateTimeProvider, target } =
      await createTest();

    const response = await controller.requestVerificationCode({
      params: {
        type: "link",
      },
      body: {
        target,
      },
    });

    const token = response.token;

    // Travel past expiration
    await dateTimeProvider.travel(parameters.codeExpiration + 1, "seconds");

    await expect(() =>
      controller.validateVerificationCode({
        params: {
          type: "link",
        },
        body: {
          target,
          token,
        },
      }),
    ).rejects.toThrowError("Verification code has expired");
  });

  it("should return token in response", async ({ expect }) => {
    const { parameters, controller, target } = await createTest();

    const expectedMinutes = Math.floor(parameters.codeExpiration / 60);

    const response = await controller.requestVerificationCode({
      params: {
        type: "link",
      },
      body: {
        target,
      },
    });

    expect(response.token).toBeTruthy();
    expect(response.codeExpiration).toBe(parameters.codeExpiration);
    // Verify token is a UUID
    expect(response.token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
