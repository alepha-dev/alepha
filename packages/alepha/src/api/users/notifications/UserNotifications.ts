import { z } from "alepha";
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
    translations: {
      fr: {
        email: {
          subject: "Réinitialisez votre mot de passe",
          body: (it) => `
				<h1>Réinitialisez votre mot de passe</h1>
				<p>Bonjour,</p>
				<p>Nous avons reçu une demande de réinitialisation de votre mot de passe. Utilisez le code ci-dessous pour confirmer votre identité :</p>
				<p style="margin: 30px 0; text-align: center;">
					<span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; font-family: monospace; background-color: #f5f5f5; padding: 16px 24px; border-radius: 8px; display: inline-block;">
						${it.code}
					</span>
				</p>
				<p>Ce code expire dans ${it.expiresInMinutes} minutes.</p>
				<p>Si vous n'avez pas demandé de réinitialisation, vous pouvez ignorer cet e-mail : votre mot de passe restera inchangé.</p>
			`,
        },
      },
    },
    schema: z.object({
      email: z.string().meta({ format: "email" }),
      code: z.string(),
      expiresInMinutes: z.number(),
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
    translations: {
      fr: {
        email: {
          subject: "Vérifiez votre adresse e-mail",
          body: (it) => `
				<h1>Vérifiez votre adresse e-mail</h1>
				<p>Bonjour,</p>
				<p>Merci de votre inscription ! Utilisez le code ci-dessous pour vérifier votre adresse e-mail :</p>
				<p style="margin: 30px 0; text-align: center;">
					<span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; font-family: monospace; background-color: #f5f5f5; padding: 16px 24px; border-radius: 8px; display: inline-block;">
						${it.code}
					</span>
				</p>
				<p>Ce code expire dans ${it.expiresInMinutes} minutes.</p>
				<p>Si vous n'avez pas créé de compte, ignorez cet e-mail.</p>
			`,
        },
      },
    },
    schema: z.object({
      email: z.string().meta({ format: "email" }),
      code: z.string(),
      expiresInMinutes: z.number(),
    }),
  });

  /**
   * Sent to the address a stranger tried to register with.
   *
   * The registration endpoint answers a taken address exactly as it answers
   * a fresh one, so the attempt is invisible to whoever made it. This is the
   * out-of-band channel that tells the real owner it happened. It carries no
   * code — there is nothing for the recipient to act on beyond knowing.
   */
  public readonly registrationAttempt = $notification({
    category: "security",
    description:
      "Email sent to an existing user when someone attempts to register with their email address.",
    critical: true,
    sensitive: true,
    email: {
      subject: "Someone tried to sign up with your email address",
      body: (it) => `
			<h1>Someone Tried to Sign Up With Your Email</h1>
			<p>Hi ${it.email},</p>
			<p>We received a request to create a new account using this email address, but an account already exists for it. No new account was created and nothing about your account has changed.</p>
			<p>If this was you, you can simply sign in instead — or reset your password if you have forgotten it.</p>
			<p>If this was not you, no action is required. Someone may have mistyped their own address. If you receive these repeatedly, consider changing your password.</p>
			<p>Best regards,<br>The Team</p>
		`,
    },
    translations: {
      fr: {
        email: {
          subject: "Quelqu'un a tenté de s'inscrire avec votre adresse e-mail",
          body: (it) => `
				<h1>Tentative d'inscription avec votre adresse e-mail</h1>
				<p>Bonjour ${it.email},</p>
				<p>Nous avons reçu une demande de création de compte avec cette adresse e-mail, mais un compte existe déjà. Aucun nouveau compte n'a été créé et votre compte n'a pas été modifié.</p>
				<p>S'il s'agissait de vous, connectez-vous simplement — ou réinitialisez votre mot de passe si vous l'avez oublié.</p>
				<p>Si ce n'était pas vous, aucune action n'est nécessaire. Quelqu'un a peut-être mal saisi sa propre adresse. Si vous recevez ce message à répétition, envisagez de changer votre mot de passe.</p>
			`,
        },
      },
    },
    schema: z.object({
      email: z.string().meta({ format: "email" }),
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
    schema: z.object({
      phoneNumber: z.string(),
      code: z.string(),
      expiresInMinutes: z.number(),
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
    schema: z.object({
      email: z.string().meta({ format: "email" }),
      resetUrl: z.string(),
      expiresInMinutes: z.number(),
    }),
  });

  public readonly accountLockout = $notification({
    category: "security",
    description:
      "Email sent to users when their account is temporarily locked due to too many failed login attempts.",
    critical: true,
    sensitive: true,
    email: {
      subject: "Account temporarily locked",
      body: (it) => `
				<h1>Account Temporarily Locked</h1>
				<p>Hi ${it.email},</p>
				<p>Your account has been temporarily locked due to too many failed login attempts.</p>
				<p>If this was you, please wait ${it.lockoutMinutes} minutes before trying again. If you've forgotten your password, you can reset it using the password reset feature.</p>
				<p>If this wasn't you, someone may be trying to access your account. We recommend changing your password as soon as possible.</p>
				<p>Best regards,<br>The Team</p>
			`,
    },
    translations: {
      fr: {
        email: {
          subject: "Compte temporairement verrouillé",
          body: (it) => `
					<h1>Compte temporairement verrouillé</h1>
					<p>Bonjour,</p>
					<p>Votre compte a été temporairement verrouillé suite à un trop grand nombre de tentatives de connexion échouées.</p>
					<p>Si c'était bien vous, patientez ${it.lockoutMinutes} minutes avant de réessayer. Mot de passe oublié ? Utilisez la réinitialisation de mot de passe.</p>
					<p>Si ce n'était pas vous, quelqu'un essaie peut-être d'accéder à votre compte. Nous vous recommandons de changer votre mot de passe au plus vite.</p>
				`,
        },
      },
    },
    schema: z.object({
      email: z.string().meta({ format: "email" }),
      lockoutMinutes: z.number(),
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
    schema: z.object({
      email: z.string().meta({ format: "email" }),
      verifyUrl: z.string(),
      expiresInMinutes: z.number(),
    }),
  });
}
