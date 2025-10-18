import { $inject, t } from "@alepha/core";
import { $action } from "@alepha/server";
import { UserNotifications } from "../notifications/UserNotifications.ts";
import { SessionService } from "../services/SessionService.ts";

export class UserController {
	protected readonly sessionService = $inject(SessionService);
	protected readonly userNotifications = $inject(UserNotifications);

	/**
	 * Request a password reset.
	 * Generates a reset token and sends an email to the user.
	 */
	public requestPasswordReset = $action({
		path: "/users/password-reset/request",
		group: "users",
		schema: {
			body: t.object({
				email: t.email(),
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

				await this.userNotifications.passwordReset.push({
					contact: body.email,
					variables: {
						email: body.email,
						resetUrl: resetUrlWithToken,
						expiresInMinutes,
					},
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
	 */
	public validateResetToken = $action({
		path: "/users/password-reset/validate",
		group: "users",
		schema: {
			query: t.object({
				token: t.string(),
			}),
			response: t.object({
				valid: t.boolean(),
				email: t.optional(t.email()),
			}),
		},
		handler: async ({ query }) => {
			try {
				const email = await this.sessionService.validateResetToken(query.token);
				return {
					valid: true,
					email,
				};
			} catch {
				return {
					valid: false,
				};
			}
		},
	});

	/**
	 * Reset password with a valid token.
	 * Updates the user's password and invalidates all sessions.
	 */
	public resetPassword = $action({
		path: "/users/password-reset/reset",
		group: "users",
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
