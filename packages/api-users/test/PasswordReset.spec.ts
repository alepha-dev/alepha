import { Alepha } from "@alepha/core";
import { AlephaDateTime, DateTimeProvider } from "@alepha/datetime";
import { AlephaEmail, MemoryEmailProvider } from "@alepha/email";
import { AlephaPostgres } from "@alepha/postgres";
import { AlephaSecurity, CryptoProvider } from "@alepha/security";
import { AlephaServer, BadRequestError } from "@alepha/server";
import { describe, it } from "vitest";
import {
	AlephaApiUsers,
	PasswordResetController,
	SessionService,
} from "../src/index.ts";

const setup = async () => {
	const alepha = Alepha.create({
		env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
	});

	alepha.with(AlephaPostgres);
	alepha.with(AlephaSecurity);
	alepha.with(AlephaDateTime);
	alepha.with(AlephaEmail);
	alepha.with(AlephaServer);
	alepha.with(AlephaApiUsers);

	await alepha.start();

	return {
		alepha,
		sessionService: alepha.inject(SessionService),
		cryptoProvider: alepha.inject(CryptoProvider),
		dateTimeProvider: alepha.inject(DateTimeProvider),
		emailProvider: alepha.inject(MemoryEmailProvider),
		actions: alepha.inject(PasswordResetController),
	};
};

describe("@alepha/api-users - Password Reset", () => {
	it("should successfully request password reset and send email", async ({
		expect,
	}) => {
		const { sessionService, cryptoProvider, emailProvider, actions } =
			await setup();

		// Create a test user with credentials
		const hashedPassword = await cryptoProvider.hashPassword("OldPassword123");
		const user = await sessionService.users.create({
			email: "test@example.com",
			roles: ["user"],
		});

		await sessionService.identities.create({
			userId: user.id,
			provider: "credentials",
			providerUserId: "test@example.com",
			providerData: { password: hashedPassword },
		});

		// Request password reset
		const result = await actions.requestPasswordReset.run({
			body: {
				email: "test@example.com",
				resetUrl: "https://example.com/reset-password",
			},
		});

		expect(result.success).toBe(true);
		expect(result.message).toContain("password reset link has been sent");

		// Verify email was sent
		const emails = emailProvider.getEmails();
		expect(emails).toHaveLength(1);

		const email = emails[0];
		expect(email.to).toBe("test@example.com");
		expect(email.subject).toBe("Reset your password");
		expect(email.body).toContain("Reset Your Password");
		expect(email.body).toContain("test@example.com");
		expect(email.body).toContain("https://example.com/reset-password?token=");
		expect(email.body).toContain("60 minutes");
	});

	it("should not reveal if email does not exist", async ({ expect }) => {
		const { emailProvider, actions } = await setup();

		// Request password reset for non-existent email
		const result = await actions.requestPasswordReset.run({
			body: {
				email: "nonexistent@example.com",
				resetUrl: "https://example.com/reset-password",
			},
		});

		// Should return success to prevent email enumeration
		expect(result.success).toBe(true);
		expect(result.message).toContain("password reset link has been sent");

		// But no email should be sent
		const emails = emailProvider.getEmails();
		expect(emails).toHaveLength(0);
	});

	it("should not send email for OAuth-only users", async ({ expect }) => {
		const { sessionService, emailProvider, actions } = await setup();

		// Create a user with only OAuth identity (no credentials)
		const user = await sessionService.users.create({
			email: "oauth@example.com",
			roles: ["user"],
		});

		await sessionService.identities.create({
			userId: user.id,
			provider: "google",
			providerUserId: "google-123",
		});

		// Request password reset
		const result = await actions.requestPasswordReset.run({
			body: {
				email: "oauth@example.com",
				resetUrl: "https://example.com/reset-password",
			},
		});

		// Should return success but not send email
		expect(result.success).toBe(true);

		const emails = emailProvider.getEmails();
		expect(emails).toHaveLength(0);
	});

	it("should validate a valid reset token", async ({ expect }) => {
		const { sessionService, cryptoProvider, actions } = await setup();

		// Create a test user with credentials
		const hashedPassword = await cryptoProvider.hashPassword("OldPassword123");
		const user = await sessionService.users.create({
			email: "test@example.com",
			roles: ["user"],
		});

		await sessionService.identities.create({
			userId: user.id,
			provider: "credentials",
			providerUserId: "test@example.com",
			providerData: { password: hashedPassword },
		});

		// Request password reset
		const token = await sessionService.requestPasswordReset("test@example.com");

		// Token should be generated for valid user
		expect(token).toBeTruthy();
		expect(token.length).toBeGreaterThan(0);

		// Validate token
		const result = await actions.validateResetToken.run({
			query: { token },
		});

		expect(result.valid).toBe(true);
		expect(result.email).toBe("test@example.com");
	});

	it("should reject invalid reset token", async ({ expect }) => {
		const { actions } = await setup();

		// Validate invalid token
		const result = await actions.validateResetToken.run({
			query: { token: "invalid-token-123" },
		});

		expect(result.valid).toBe(false);
		expect(result.email).toBeUndefined();
	});

	it("should reject expired reset token", async ({ expect }) => {
		const { sessionService, cryptoProvider, dateTimeProvider, actions } =
			await setup();

		// Create a test user with credentials
		const hashedPassword = await cryptoProvider.hashPassword("OldPassword123");
		const user = await sessionService.users.create({
			email: "test@example.com",
			roles: ["user"],
		});

		await sessionService.identities.create({
			userId: user.id,
			provider: "credentials",
			providerUserId: "test@example.com",
			providerData: { password: hashedPassword },
		});

		// Request password reset
		const token = await sessionService.requestPasswordReset("test@example.com");

		// Travel forward in time to expire the token (default expiration is 60 minutes)
		dateTimeProvider.travel(61, "minutes");

		// Validate expired token
		const result = await actions.validateResetToken.run({
			query: { token },
		});

		expect(result.valid).toBe(false);
		expect(result.email).toBeUndefined();
	});

	it("should successfully reset password with valid token", async ({
		expect,
	}) => {
		const { sessionService, cryptoProvider, actions } = await setup();

		// Create a test user with credentials
		const hashedPassword = await cryptoProvider.hashPassword("OldPassword123");
		const user = await sessionService.users.create({
			email: "test@example.com",
			roles: ["user"],
		});

		await sessionService.identities.create({
			userId: user.id,
			provider: "credentials",
			providerUserId: "test@example.com",
			providerData: { password: hashedPassword },
		});

		// Request password reset
		const token = await sessionService.requestPasswordReset("test@example.com");

		// Reset password
		const result = await actions.resetPassword.run({
			body: {
				token,
				newPassword: "NewPassword456",
			},
		});

		expect(result.success).toBe(true);
		expect(result.message).toContain("Password has been reset successfully");

		// Verify old password no longer works
		await expect(
			sessionService.login("credentials", "test@example.com", "OldPassword123"),
		).rejects.toThrow();

		// Verify new password works
		const loggedInUser = await sessionService.login(
			"credentials",
			"test@example.com",
			"NewPassword456",
		);
		expect(loggedInUser.email).toBe("test@example.com");
	});

	it("should reject password reset with invalid token", async ({ expect }) => {
		const { actions } = await setup();

		// Attempt to reset password with invalid token
		await expect(
			actions.resetPassword.run({
				body: {
					token: "invalid-token-123",
					newPassword: "NewPassword456",
				},
			}),
		).rejects.toThrowError(BadRequestError);
	});

	it("should reject password reset with expired token", async ({ expect }) => {
		const { sessionService, cryptoProvider, dateTimeProvider, actions } =
			await setup();

		// Create a test user with credentials
		const hashedPassword = await cryptoProvider.hashPassword("OldPassword123");
		const user = await sessionService.users.create({
			email: "test@example.com",
			roles: ["user"],
		});

		await sessionService.identities.create({
			userId: user.id,
			provider: "credentials",
			providerUserId: "test@example.com",
			providerData: { password: hashedPassword },
		});

		// Request password reset
		const token = await sessionService.requestPasswordReset("test@example.com");

		// Travel forward in time to expire the token (default expiration is 60 minutes)
		dateTimeProvider.travel(61, "minutes");

		// Attempt to reset password with expired token
		await expect(
			actions.resetPassword.run({
				body: {
					token,
					newPassword: "NewPassword456",
				},
			}),
		).rejects.toThrowError(BadRequestError);
	});

	it("should clear reset token after successful password reset", async ({
		expect,
	}) => {
		const { sessionService, cryptoProvider, actions } = await setup();

		// Create a test user with credentials
		const hashedPassword = await cryptoProvider.hashPassword("OldPassword123");
		const user = await sessionService.users.create({
			email: "test@example.com",
			roles: ["user"],
		});

		await sessionService.identities.create({
			userId: user.id,
			provider: "credentials",
			providerUserId: "test@example.com",
			providerData: { password: hashedPassword },
		});

		// Request password reset
		const token = await sessionService.requestPasswordReset("test@example.com");

		// Reset password
		await actions.resetPassword.run({
			body: {
				token,
				newPassword: "NewPassword456",
			},
		});

		// Attempt to use the same token again should fail
		await expect(
			actions.resetPassword.run({
				body: {
					token,
					newPassword: "AnotherPassword789",
				},
			}),
		).rejects.toThrowError(BadRequestError);
	});

	it("should invalidate all sessions after password reset", async ({
		expect,
	}) => {
		const { sessionService, cryptoProvider, actions } = await setup();

		// Create a test user with credentials
		const hashedPassword = await cryptoProvider.hashPassword("OldPassword123");
		const user = await sessionService.users.create({
			email: "test@example.com",
			roles: ["user"],
		});

		await sessionService.identities.create({
			userId: user.id,
			provider: "credentials",
			providerUserId: "test@example.com",
			providerData: { password: hashedPassword },
		});

		// Create some sessions
		const session1 = await sessionService.createSession(user, 3600);
		const session2 = await sessionService.createSession(user, 3600);

		// Verify sessions exist
		const existingSessions = await sessionService.sessions.find({
			where: { userId: { eq: user.id } },
		});
		expect(existingSessions).toHaveLength(2);

		// Request password reset and reset password
		const token = await sessionService.requestPasswordReset("test@example.com");
		await actions.resetPassword.run({
			body: {
				token,
				newPassword: "NewPassword456",
			},
		});

		// Verify all sessions are deleted
		const remainingSessions = await sessionService.sessions.find({
			where: { userId: { eq: user.id } },
		});
		expect(remainingSessions).toHaveLength(0);
	});

	it("should enforce minimum password length", async ({ expect }) => {
		const { sessionService, cryptoProvider, actions } = await setup();

		// Create a test user with credentials
		const hashedPassword = await cryptoProvider.hashPassword("OldPassword123");
		const user = await sessionService.users.create({
			email: "test@example.com",
			roles: ["user"],
		});

		await sessionService.identities.create({
			userId: user.id,
			provider: "credentials",
			providerUserId: "test@example.com",
			providerData: { password: hashedPassword },
		});

		// Request password reset
		const token = await sessionService.requestPasswordReset("test@example.com");

		// Attempt to reset with short password (less than 8 characters)
		await expect(
			actions.resetPassword.run({
				body: {
					token,
					newPassword: "Short1", // Only 6 characters
				},
			}),
		).rejects.toThrow();
	});

	it("should allow multiple password reset requests", async ({ expect }) => {
		const { sessionService, cryptoProvider, emailProvider, actions } =
			await setup();

		// Create a test user with credentials
		const hashedPassword = await cryptoProvider.hashPassword("OldPassword123");
		const user = await sessionService.users.create({
			email: "test@example.com",
			roles: ["user"],
		});

		await sessionService.identities.create({
			userId: user.id,
			provider: "credentials",
			providerUserId: "test@example.com",
			providerData: { password: hashedPassword },
		});

		// Request password reset multiple times
		await actions.requestPasswordReset.run({
			body: {
				email: "test@example.com",
				resetUrl: "https://example.com/reset-password",
			},
		});

		await actions.requestPasswordReset.run({
			body: {
				email: "test@example.com",
				resetUrl: "https://example.com/reset-password",
			},
		});

		// Verify multiple emails were sent
		const emails = emailProvider.getEmails();
		expect(emails.length).toBeGreaterThanOrEqual(2);
	});
});
