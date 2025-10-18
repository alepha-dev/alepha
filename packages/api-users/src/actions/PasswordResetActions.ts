import { $inject, t } from "@alepha/core";
import { $action } from "@alepha/server";
import { $passwordResetEmail } from "../descriptors/$passwordResetEmail.ts";
import { SessionService } from "../services/SessionService.ts";

/**
 * Actions for password reset functionality.
 *
 * This class provides API endpoints for:
 * - Requesting a password reset (sends email with token)
 * - Validating a reset token
 * - Resetting the password with a valid token
 */
export class PasswordResetActions {
	protected readonly sessionService = $inject(SessionService);
	protected readonly passwordResetEmail = $passwordResetEmail();

	/**
	 * Request a password reset.
	 * Generates a reset token and sends an email to the user.
	 *
	 * POST /api/password-reset/request
	 */
	public requestPasswordReset = $action({
		schema: {
			body: t.object({
				email: t.string({ format: "email" }),
				resetUrl: t.string(),
			}),
			response: t.object({
				success: t.boolean(),
				message: t.string(),
			}),
		},
		handler: async ({ body }) => {
			const expiresInMinutes = 60;
			const token = await this.sessionService.requestPasswordReset(
				body.email,
				expiresInMinutes,
			);

			// Only send email if token was generated (user exists)
			if (token) {
				// Build the full reset URL with token
				const resetUrlWithToken = `${body.resetUrl}?token=${token}`;

				await this.passwordResetEmail.send(body.email, {
					email: body.email,
					resetUrl: resetUrlWithToken,
					expiresInMinutes,
				});
			}

			// Always return success to prevent email enumeration
			return {
				success: true,
				message:
					"If an account exists with this email, a password reset link has been sent.",
			};
		},
	});

	/**
	 * Validate a password reset token.
	 * Checks if the token is valid and not expired.
	 *
	 * GET /api/password-reset/validate
	 */
	public validateResetToken = $action({
		schema: {
			query: t.object({
				token: t.string(),
			}),
			response: t.object({
				valid: t.boolean(),
				email: t.optional(t.string({ format: "email" })),
			}),
		},
		handler: async ({ query }) => {
			try {
				const email = await this.sessionService.validateResetToken(query.token);
				return {
					valid: true,
					email,
				};
			} catch (_error) {
				return {
					valid: false,
				};
			}
		},
	});

	/**
	 * Reset password with a valid token.
	 * Updates the user's password and invalidates all sessions.
	 *
	 * POST /api/password-reset/reset
	 */
	public resetPassword = $action({
		schema: {
			body: t.object({
				token: t.string(),
				newPassword: t.string({ minLength: 8 }),
			}),
			response: t.object({
				success: t.boolean(),
				message: t.string(),
			}),
		},
		handler: async ({ body }) => {
			await this.sessionService.resetPassword(body.token, body.newPassword);

			return {
				success: true,
				message: "Password has been reset successfully. Please log in.",
			};
		},
	});
}
