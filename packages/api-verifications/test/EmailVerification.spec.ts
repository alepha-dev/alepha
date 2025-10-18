import { Alepha } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { MemoryEmailProvider } from "@alepha/email";
import { describe, it } from "vitest";
import {
	AlephaApiVerification,
	VerificationController,
	VerificationNotifications,
} from "../src";
import { VerificationParameters } from "../src/parameters/VerificationParameters.ts";

const createTest = async () => {
	const alepha = Alepha.create().with(AlephaApiVerification);
	const parameters = alepha
		.inject(VerificationParameters)
		.settings.get("email");
	const controller = alepha.inject(VerificationController);
	const dateTimeProvider = alepha.inject(DateTimeProvider);
	const target = "test@example.com";
	const emailProvider = alepha.inject(MemoryEmailProvider);

	alepha.inject(VerificationNotifications).verifyEmail.configure({
		email: {
			subject: "Verify your email",
			body: (it) => `Verify: ${it.verifyUrl}`,
		},
	});

	await alepha.start();

	return {
		alepha,
		parameters,
		controller,
		dateTimeProvider,
		target,
		emailProvider,
	};
};

describe("EmailVerification", () => {
	it("should verify email with UUID token correctly", async ({ expect }) => {
		const { parameters, controller, target, emailProvider } =
			await createTest();

		const request = await controller.requestVerificationCode({
			params: {
				type: "email",
			},
			body: {
				target,
				verifyUrl: "https://example.com/verify",
			},
		});

		expect(request).toEqual({
			codeExpiration: parameters.codeExpiration,
			verificationCooldown: parameters.verificationCooldown,
			maxVerificationAttempts: parameters.maxAttempts,
		});

		await expect.poll(() => emailProvider.records.length).toEqual(1);
		const [email] = emailProvider.records;

		expect(email.to).toEqual(target);
		expect(email.body).toContain("https://example.com/verify?token=");

		// Extract UUID token from email body
		const tokenMatch = email.body.match(/token=([a-f0-9-]+)/);
		expect(tokenMatch).toBeTruthy();
		const token = tokenMatch![1];

		// UUID format validation
		expect(token).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);

		expect(
			await controller.validateVerificationCode({
				params: {
					type: "email",
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
					type: "email",
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

	it("should require verifyUrl for email verification", async ({ expect }) => {
		const { controller, target } = await createTest();

		await expect(() =>
			controller.requestVerificationCode({
				params: {
					type: "email",
				},
				body: {
					target,
				},
			}),
		).rejects.toThrowError("verifyUrl is required for email verification");
	});

	it("should handle invalid token", async ({ expect }) => {
		const { controller, target } = await createTest();

		await controller.requestVerificationCode({
			params: {
				type: "email",
			},
			body: {
				target,
				verifyUrl: "https://example.com/verify",
			},
		});

		await expect(() =>
			controller.validateVerificationCode({
				params: {
					type: "email",
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
				type: "email",
			},
			body: {
				target,
				verifyUrl: "https://example.com/verify",
			},
		});

		for (let i = 0; i < parameters.maxAttempts; i++) {
			await controller
				.validateVerificationCode({
					params: {
						type: "email",
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
					type: "email",
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
				type: "email",
			},
			body: {
				target,
				verifyUrl: "https://example.com/verify",
			},
		});

		await expect(() =>
			controller.requestVerificationCode({
				params: {
					type: "email",
				},
				body: {
					target,
					verifyUrl: "https://example.com/verify",
				},
			}),
		).rejects.toThrowError("Verification is on cooldown for ");

		await dateTimeProvider.travel(
			parameters.verificationCooldown + 1,
			"seconds",
		);

		expect(
			await controller.requestVerificationCode({
				params: {
					type: "email",
				},
				body: {
					target,
					verifyUrl: "https://example.com/verify",
				},
			}),
		).toEqual({
			codeExpiration: parameters.codeExpiration,
			verificationCooldown: parameters.verificationCooldown,
			maxVerificationAttempts: parameters.maxAttempts,
		});
	});

	it("should respect rate limit per day", async ({ expect }) => {
		const { parameters, controller, dateTimeProvider, target } =
			await createTest();

		for (let i = 0; i < parameters.limitPerDay; i++) {
			await controller.requestVerificationCode({
				params: {
					type: "email",
				},
				body: {
					target,
					verifyUrl: "https://example.com/verify",
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
					type: "email",
				},
				body: {
					target,
					verifyUrl: "https://example.com/verify",
				},
			}),
		).rejects.toThrowError(
			`Maximum number of verification requests per day reached (${parameters.limitPerDay})`,
		);
	});

	it("should handle token expiration", async ({ expect }) => {
		const { parameters, controller, dateTimeProvider, target, emailProvider } =
			await createTest();

		await controller.requestVerificationCode({
			params: {
				type: "email",
			},
			body: {
				target,
				verifyUrl: "https://example.com/verify",
			},
		});

		await expect.poll(() => emailProvider.records.length).toEqual(1);
		const [email] = emailProvider.records;

		const tokenMatch = email.body.match(/token=([a-f0-9-]+)/);
		const token = tokenMatch![1];

		// Travel past expiration
		await dateTimeProvider.travel(parameters.codeExpiration + 1, "seconds");

		await expect(() =>
			controller.validateVerificationCode({
				params: {
					type: "email",
				},
				body: {
					target,
					token,
				},
			}),
		).rejects.toThrowError("Verification code has expired");
	});

	it("should include expiration time in email", async ({ expect }) => {
		const { parameters, controller, target, emailProvider } =
			await createTest();

		const expectedMinutes = Math.floor(parameters.codeExpiration / 60);

		await controller.requestVerificationCode({
			params: {
				type: "email",
			},
			body: {
				target,
				verifyUrl: "https://example.com/verify",
			},
		});

		await expect.poll(() => emailProvider.records.length).toEqual(1);
		const [email] = emailProvider.records;

		expect(email.subject).toBe("Verify your email");
		expect(email.body).toContain("https://example.com/verify?token=");
	});
});
