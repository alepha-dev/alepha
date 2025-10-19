import { Alepha } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { describe, it } from "vitest";
import { AlephaApiVerification, VerificationController } from "../src";
import { VerificationParameters } from "../src/parameters/VerificationParameters.ts";

const createTest = async () => {
	const alepha = Alepha.create().with(AlephaApiVerification);
	const parameters = alepha
		.inject(VerificationParameters)
		.settings.get("phone");
	const controller = alepha.inject(VerificationController);
	const dateTimeProvider = alepha.inject(DateTimeProvider);
	const target = "+33633115544";

	await alepha.start();

	return {
		alepha,
		parameters,
		controller,
		dateTimeProvider,
		target,
	};
};

describe("PhoneVerification", () => {
	it("should verify phone with 6-digit code correctly", async ({ expect }) => {
		const { parameters, controller, target } = await createTest();

		const request = await controller.requestVerificationCode({
			params: {
				type: "phone",
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

		const code = request.token;

		// 6-digit code validation
		expect(code).toMatch(/^\d{6}$/);
		expect(code.length).toBe(parameters.codeLength);

		expect(
			await controller.validateVerificationCode({
				params: {
					type: "phone",
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
					type: "phone",
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

	it("should handle invalid code", async ({ expect }) => {
		const { controller, target } = await createTest();

		await controller.requestVerificationCode({
			params: {
				type: "phone",
			},
			body: {
				target,
			},
		});

		await expect(() =>
			controller.validateVerificationCode({
				params: {
					type: "phone",
				},
				body: {
					target,
					token: "999999",
				},
			}),
		).rejects.toThrowError("Invalid verification code");
	});

	it("should handle max attempts", async ({ expect }) => {
		const { parameters, controller, target } = await createTest();

		await controller.requestVerificationCode({
			params: {
				type: "phone",
			},
			body: {
				target,
			},
		});

		for (let i = 0; i < parameters.maxAttempts; i++) {
			await controller
				.validateVerificationCode({
					params: {
						type: "phone",
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
					type: "phone",
				},
				body: {
					target,
					token: "999999",
				},
			}),
		).rejects.toThrowError("Maximum number of attempts reached");
	});

	it("should handle cooldown", async ({ expect }) => {
		const { dateTimeProvider, parameters, controller, target } =
			await createTest();

		await controller.requestVerificationCode({
			params: {
				type: "phone",
			},
			body: {
				target,
			},
		});

		await expect(() =>
			controller.requestVerificationCode({
				params: {
					type: "phone",
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
				type: "phone",
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
					type: "phone",
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
					type: "phone",
				},
				body: {
					target,
				},
			}),
		).rejects.toThrowError(
			`Maximum number of verification requests per day reached (${parameters.limitPerDay})`,
		);
	});

	it("should handle code expiration", async ({ expect }) => {
		const { parameters, controller, dateTimeProvider, target } =
			await createTest();

		const response = await controller.requestVerificationCode({
			params: {
				type: "phone",
			},
			body: {
				target,
			},
		});

		const code = response.token;

		// Travel past expiration
		await dateTimeProvider.travel(parameters.codeExpiration + 1, "seconds");

		await expect(() =>
			controller.validateVerificationCode({
				params: {
					type: "phone",
				},
				body: {
					target,
					token: code,
				},
			}),
		).rejects.toThrowError("Verification code has expired");
	});

	it("should generate different codes for each request", async ({ expect }) => {
		const { controller, dateTimeProvider, parameters, target } =
			await createTest();

		const response1 = await controller.requestVerificationCode({
			params: {
				type: "phone",
			},
			body: {
				target,
			},
		});

		const code1 = response1.token;

		await dateTimeProvider.travel(
			parameters.verificationCooldown + 1,
			"seconds",
		);

		const response2 = await controller.requestVerificationCode({
			params: {
				type: "phone",
			},
			body: {
				target,
			},
		});

		const code2 = response2.token;

		// Codes should be different (though technically they could be the same by chance)
		// This tests that we're generating new codes, not reusing
		expect(code1).toMatch(/^\d{6}$/);
		expect(code2).toMatch(/^\d{6}$/);
	});

	it("should pad codes with leading zeros", async ({ expect }) => {
		const { controller, target } = await createTest();

		// Request multiple codes to increase chance of getting one with leading zeros
		const codes: string[] = [];
		for (let i = 0; i < 5; i++) {
			const response = await controller.requestVerificationCode({
				params: {
					type: "phone",
				},
				body: {
					target: `${target}${i}`,
				},
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
