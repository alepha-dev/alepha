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
		.settings.get("policy");
	const controller = alepha.inject(VerificationController);
	const dateTimeProvider = alepha.inject(DateTimeProvider);
	const target = "+33633115544";
	const emailProvider = alepha.inject(MemoryEmailProvider);

	alepha.inject(VerificationNotifications).verifyEmail.configure({
		email: {
			subject: "",
			body: (it) => it.code,
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

describe("VerificationController", () => {
	it("should verify code correctly", async ({ expect }) => {
		const { parameters, controller, target, emailProvider } =
			await createTest();

		const request = await controller.requestVerificationCode({
			params: {
				type: "email",
			},
			body: {
				target,
			},
		});

		expect(request).toEqual({
			codeExpiration: parameters.codeExpiration,
			verificationCooldown: parameters.verificationCooldown,
			maxVerificationAttempts: parameters.maxAttempts,
		});

		await expect.poll(() => emailProvider.getEmails().length).toEqual(1);
		const [email] = emailProvider.getEmails();

		expect(email.to).toEqual(target);
		const code = email.body;

		expect(
			await controller.validateVerificationCode({
				params: {
					type: "email",
				},
				body: {
					target,
					code,
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
					code,
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
				type: "email",
			},
			body: {
				target,
			},
		});

		await expect(() =>
			controller.validateVerificationCode({
				params: {
					type: "email",
				},
				body: {
					target,
					code: "aaaaaa",
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
						code: "aaaaaa",
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
					code: "aaaaaa",
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
			},
		});

		await expect(() =>
			controller.requestVerificationCode({
				params: {
					type: "email",
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

		expect(
			await controller.requestVerificationCode({
				params: {
					type: "email",
				},
				body: {
					target,
				},
			}),
		).toEqual({
			codeExpiration: parameters.codeExpiration,
			verificationCooldown: parameters.verificationCooldown,
			maxVerificationAttempts: parameters.maxAttempts,
		});
	});

	// note: this test will fail if you run it between 23:50 and 00:00
	it("it should respect rate limit", async ({ expect }) => {
		const { parameters, controller, dateTimeProvider, target } =
			await createTest();

		for (let i = 0; i < parameters.limitPerDay; i++) {
			await controller.requestVerificationCode({
				params: {
					type: "email",
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
					type: "email",
				},
				body: {
					target,
				},
			}),
		).rejects.toThrowError(
			`Maximum number of verification requests per day reached (${parameters.limitPerDay})`,
		);
	});
});
