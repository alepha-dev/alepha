import { $notification } from "@alepha/api-notifications";
import { t } from "@alepha/core";

export class VerificationNotifications {
	public readonly verifyEmail = $notification({
		category: "security",
		description: "When a email verification code is sent to someone.",
		critical: true,
		sensitive: true,
		email: {
			subject: "Your verification code",
			body: (it) => `
			<h1>Your Verification Code</h1>
			<p>Your verification code is: <strong>${it.code}</strong></p>
			<p>If you did not request this code, please ignore this email.</p>
			<p>Best regards,<br>The Team</p>
		`,
		},
		schema: t.object({
			code: t.text(),
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
