import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";
import { completePasswordResetRequestSchema } from "../schemas/completePasswordResetRequestSchema.ts";
import { completeRegistrationRequestSchema } from "../schemas/completeRegistrationRequestSchema.ts";
import { passwordResetIntentResponseSchema } from "../schemas/passwordResetIntentResponseSchema.ts";
import { registerQuerySchema } from "../schemas/registerQuerySchema.ts";
import { registerRequestSchema } from "../schemas/registerRequestSchema.ts";
import { registrationIntentResponseSchema } from "../schemas/registrationIntentResponseSchema.ts";
import { userResourceSchema } from "../schemas/userResourceSchema.ts";
import { CredentialService } from "../services/CredentialService.ts";
import { RegistrationService } from "../services/RegistrationService.ts";
import { UserService } from "../services/UserService.ts";

export class UserController {
  protected readonly url = "/users";
  protected readonly group = "users";
  protected readonly credentialService = $inject(CredentialService);
  protected readonly userService = $inject(UserService);
  protected readonly registrationService = $inject(RegistrationService);

  /**
   * Phase 1: Create a registration intent.
   * Validates data, creates verification sessions, and stores intent in cache.
   */
  public readonly createRegistrationIntent = $action({
    group: this.group,
    method: "POST",
    path: `${this.url}/register`,
    schema: {
      body: registerRequestSchema,
      query: registerQuerySchema,
      response: registrationIntentResponseSchema,
    },
    handler: ({ body, query }) =>
      this.registrationService.createRegistrationIntent(
        body,
        query.userRealmName,
      ),
  });

  /**
   * Phase 2: Complete registration using an intent.
   * Validates verification codes and creates the user.
   */
  public readonly createUserFromIntent = $action({
    group: this.group,
    method: "POST",
    path: `${this.url}/register/complete`,
    schema: {
      body: completeRegistrationRequestSchema,
      response: userResourceSchema,
    },
    handler: ({ body }) => this.registrationService.completeRegistration(body),
  });

  /**
   * Phase 1: Create a password reset intent.
   * Validates email, sends verification code, and stores intent in cache.
   */
  public readonly createPasswordResetIntent = $action({
    group: this.group,
    method: "POST",
    path: `${this.url}/password-reset`,
    schema: {
      query: z.object({
        userRealmName: z.string().optional(),
      }),
      body: z.object({
        email: z.email(),
        // Required when the realm sets `captchaRequired`. The client learns
        // whether to render a widget from `captchaSiteKey` on the realm
        // config endpoint, same as registration.
        captchaToken: z
          .string()
          .describe("Captcha response token (if captcha is required)")
          .optional(),
      }),
      response: passwordResetIntentResponseSchema,
    },
    handler: ({ body, query }) =>
      this.credentialService.createPasswordResetIntent(
        body.email,
        query.userRealmName,
        body.captchaToken,
      ),
  });

  /**
   * Phase 2: Complete password reset using an intent.
   * Validates verification code, updates password, and invalidates sessions.
   */
  public readonly completePasswordReset = $action({
    group: this.group,
    method: "POST",
    path: `${this.url}/password-reset/complete`,
    schema: {
      body: completePasswordResetRequestSchema,
      response: okSchema,
    },
    handler: async ({ body }) => {
      await this.credentialService.completePasswordReset(body);
      return { ok: true };
    },
  });

  /**
   * Request email verification.
   * Generates a verification token using verification service and sends an email to the user.
   * @param method - The verification method: "code" (default) sends a 6-digit code, "link" sends a clickable verification link.
   * @param verifyUrl - Required when method is "link". The base URL for the verification link. Token and email will be appended as query params.
   */
  public requestEmailVerification = $action({
    path: "/users/email-verification/request",
    group: this.group,
    schema: {
      query: z.object({
        userRealmName: z.string().optional(),
        method: z
          .enum(["code", "link"])
          .describe(
            'Verification method: "code" sends a 6-digit code, "link" sends a clickable verification link. When using "link", configure verifyEmailUrl in realm settings.',
          )
          .default("code")
          .optional(),
      }),
      body: z.object({
        email: z.email(),
      }),
      response: z.object({
        success: z.boolean(),
        message: z.string(),
      }),
    },
    handler: async ({ body, query }) => {
      const method = query.method ?? "code";
      await this.userService.requestEmailVerification(
        body.email,
        query.userRealmName,
        method,
      );

      return {
        success: true,
        message:
          method === "link"
            ? "If an account exists with this email, a verification link has been sent."
            : "If an account exists with this email, a verification code has been sent.",
      };
    },
  });

  /**
   * Verify email with a valid token.
   * Updates the user's emailVerified status.
   */
  public verifyEmail = $action({
    path: "/users/email-verification/verify",
    group: this.group,
    schema: {
      query: z.object({
        userRealmName: z.string().optional(),
      }),
      body: z.object({
        email: z.email(),
        token: z.string(),
      }),
      response: z.object({
        success: z.boolean(),
        message: z.string(),
      }),
    },
    handler: async ({ body, query }) => {
      await this.userService.verifyEmail(
        body.email,
        body.token,
        query.userRealmName,
      );

      return {
        success: true,
        message: "Email has been verified successfully.",
      };
    },
  });

  /**
   * Check if an email is verified.
   */
  public checkEmailVerification = $action({
    path: "/users/email-verification/check",
    group: this.group,
    use: [$secure()],
    schema: {
      query: z.object({
        email: z.email(),
        userRealmName: z.string().optional(),
      }),
      response: z.object({
        verified: z.boolean(),
      }),
    },
    handler: async ({ query }) => {
      const verified = await this.userService.isEmailVerified(
        query.email,
        query.userRealmName,
      );

      return {
        verified,
      };
    },
  });
}
