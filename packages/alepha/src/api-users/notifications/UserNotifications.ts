import { t } from "alepha";
import { $notification } from "alepha/api/notifications";

export class UserNotifications {
  // Code-based notifications (preferred)
  public readonly passwordReset = $notification({
    category: "security",
    description:
      "Email sent to users with a verification code to reset their password.",
    critical: true,
    sensitive: true,
    email: {
      subject: "Reset your password",
      body: (it) => `
			<h1>Reset Your Password</h1>
			<p>Hi ${it.email},</p>
			<p>We received a request to reset your password. Use the code below to verify your identity:</p>
			<p style="margin: 30px 0; text-align: center;">
				<span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; font-family: monospace; background-color: #f5f5f5; padding: 16px 24px; border-radius: 8px; display: inline-block;">
					${it.code}
				</span>
			</p>
			<p>This code will expire in ${it.expiresInMinutes} minutes.</p>
			<p>If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
			<p>Best regards,<br>The Team</p>
		`,
    },
    schema: t.object({
      email: t.string({ format: "email" }),
      code: t.string(),
      expiresInMinutes: t.number(),
    }),
  });

  public readonly emailVerification = $notification({
    category: "security",
    description:
      "Email sent to users with a verification code to verify their email address.",
    critical: true,
    sensitive: true,
    email: {
      subject: "Verify your email address",
      body: (it) => `
			<h1>Verify Your Email Address</h1>
			<p>Hi ${it.email},</p>
			<p>Thanks for signing up! Use the code below to verify your email address:</p>
			<p style="margin: 30px 0; text-align: center;">
				<span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; font-family: monospace; background-color: #f5f5f5; padding: 16px 24px; border-radius: 8px; display: inline-block;">
					${it.code}
				</span>
			</p>
			<p>This code will expire in ${it.expiresInMinutes} minutes.</p>
			<p>If you did not create an account, please ignore this email.</p>
			<p>Best regards,<br>The Team</p>
		`,
    },
    schema: t.object({
      email: t.string({ format: "email" }),
      code: t.string(),
      expiresInMinutes: t.number(),
    }),
  });

  public readonly phoneVerification = $notification({
    category: "security",
    description:
      "SMS sent to users with a verification code to verify their phone number.",
    critical: true,
    sensitive: true,
    sms: {
      message: (it) =>
        `Your verification code is: ${it.code}. This code expires in ${it.expiresInMinutes} minutes.`,
    },
    schema: t.object({
      phoneNumber: t.string(),
      code: t.string(),
      expiresInMinutes: t.number(),
    }),
  });

  // Link-based notifications (alternative)
  public readonly passwordResetLink = $notification({
    category: "security",
    description: "Email sent to users with a link to reset their password.",
    critical: true,
    sensitive: true,
    email: {
      subject: "Reset your password",
      body: (it) => `
			<h1>Reset Your Password</h1>
			<p>Hi ${it.email},</p>
			<p>We received a request to reset your password. Click the link below to create a new password:</p>
			<p style="margin: 30px 0;">
				<a href="${it.resetUrl}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
					Reset Password
				</a>
			</p>
			<p>Or copy and paste this link into your browser:</p>
			<p style="word-break: break-all; color: #666;">${it.resetUrl}</p>
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

  public readonly emailVerificationLink = $notification({
    category: "security",
    description:
      "Email sent to users with a link to verify their email address.",
    critical: true,
    sensitive: true,
    email: {
      subject: "Verify your email address",
      body: (it) => `
			<h1>Verify Your Email Address</h1>
			<p>Hi ${it.email},</p>
			<p>Thanks for signing up! Click the button below to verify your email address:</p>
			<p style="margin: 30px 0;">
				<a href="${it.verifyUrl}" style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
					Verify Email
				</a>
			</p>
			<p>Or copy and paste this link into your browser:</p>
			<p style="word-break: break-all; color: #666;">${it.verifyUrl}</p>
			<p>This link will expire in ${it.expiresInMinutes} minutes.</p>
			<p>If you did not create an account, please ignore this email.</p>
			<p>Best regards,<br>The Team</p>
		`,
    },
    schema: t.object({
      email: t.string({ format: "email" }),
      verifyUrl: t.string(),
      expiresInMinutes: t.number(),
    }),
  });
}
