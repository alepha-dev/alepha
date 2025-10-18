import { $notification } from "@alepha/api-notifications";
import { t } from "@alepha/core";

export class VerificationNotifications {
	public readonly verifyEmail = $notification({
		category: "security",
		description: "When an email verification link is sent to someone.",
		critical: true,
		sensitive: true,
		email: {
			subject: "Verify your email address",
			body: (it) => `
			<h1>Verify Your Email Address</h1>
			<p>Click the button below to verify your email address:</p>
			<p style="margin: 30px 0;">
				<a href="${it.verifyUrl}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Verify Email</a>
			</p>
			<p>Or copy and paste this link into your browser:</p>
			<p style="word-break: break-all; color: #666;">${it.verifyUrl}</p>
			<p>This link will expire in ${it.expiresInMinutes} minutes.</p>
			<p>If you did not request this verification, please ignore this email.</p>
			<p>Best regards,<br>The Team</p>
		`,
		},
		schema: t.object({
			verifyUrl: t.string(),
			expiresInMinutes: t.int(),
		}),
	});

	public readonly verifyPhoneNumber = $notification({
		category: "security",
		description: "When a phone verification code is sent to someone.",
		critical: true,
		sensitive: true,
		sms: {
			message: (it) => `Your verification code is ${it.code}.`,
		},
		schema: t.object({
			code: t.text(),
		}),
	});
}
