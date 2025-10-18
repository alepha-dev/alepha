import { $notification } from "@alepha/api-notifications";
import { t } from "@alepha/core";

export class UserNotifications {
	public readonly passwordReset = $notification({
		description: "Email sent to users to reset their password.",
		email: {
			subject: "Reset your password",
			body: (it) => `
			<h1>Reset Your Password</h1>
			<p>Hi ${it.email},</p>
			<p>We received a request to reset your password. Click the link below to create a new password:</p>
			<p>
				<a href="${it.resetUrl}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: #ffffff; text-decoration: none; border-radius: 5px;">
					Reset Password
				</a>
			</p>
			<p>Or copy and paste this link into your browser:</p>
			<p>${it.resetUrl}</p>
			<p>This link will expire in ${it.expiresInMinutes} minutes.</p>
			<p>If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
			<p>Best regards,<br>The Team</p>
		`,
		},
		schema: t.object({
			email: t.string({ format: "email" }),
			resetUrl: t.string(),
			expiresInMinutes: t.number(),
		}),
	});
}
