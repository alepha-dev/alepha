import { $inject, t } from "alepha";
import { pg } from "alepha/orm";
import { $action, okSchema } from "alepha/server";
import { createUserSchema } from "../schemas/createUserSchema.ts";
import { updateUserSchema } from "../schemas/updateUserSchema.ts";
import { userQuerySchema } from "../schemas/userQuerySchema.ts";
import { userResourceSchema } from "../schemas/userResourceSchema.ts";
import { CredentialService } from "../services/CredentialService.ts";
import { UserService } from "../services/UserService.ts";

export class UserController {
  protected readonly url = "/users";
  protected readonly group = "users";
  protected readonly credentialService = $inject(CredentialService);
  protected readonly userService = $inject(UserService);

  /**
   * Find users with pagination and filtering.
   */
  public readonly findUsers = $action({
    path: this.url,
    group: this.group,
    description: "Find users with pagination and filtering",
    schema: {
      query: t.extend(userQuerySchema, {
        userRealmName: t.optional(t.string()),
      }),
      response: pg.page(userResourceSchema),
    },
    handler: ({ query }) => {
      const { userRealmName, ...q } = query;
      return this.userService.findUsers(q, userRealmName);
    },
  });

  /**
   * Get a user by ID.
   */
  public readonly getUser = $action({
    path: `${this.url}/:id`,
    group: this.group,
    description: "Get a user by ID",
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      query: t.object({
        userRealmName: t.optional(t.string()),
      }),
      response: userResourceSchema,
    },
    handler: ({ params, query }) => this.userService.getUserById(params.id, query.userRealmName),
  });

  /**
   * Create a new user.
   */
  public readonly createUser = $action({
    method: "POST",
    path: this.url,
    group: this.group,
    description: "Create a new user",
    schema: {
      query: t.object({
        userRealmName: t.optional(t.string()),
      }),
      body: createUserSchema,
      response: userResourceSchema,
    },
    handler: ({ body, query }) => this.userService.createUser(body, query.userRealmName),
  });

  /**
   * Update a user.
   */
  public readonly updateUser = $action({
    method: "PATCH",
    path: `${this.url}/:id`,
    group: this.group,
    description: "Update a user",
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      query: t.object({
        userRealmName: t.optional(t.string()),
      }),
      body: updateUserSchema,
      response: userResourceSchema,
    },
    handler: ({ params, body, query }) => this.userService.updateUser(params.id, body, query.userRealmName),
  });

  /**
   * Delete a user.
   */
  public readonly deleteUser = $action({
    method: "DELETE",
    path: `${this.url}/:id`,
    group: this.group,
    description: "Delete a user",
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      query: t.object({
        userRealmName: t.optional(t.string()),
      }),
      response: okSchema,
    },
    handler: async ({ params, query }) => {
      await this.userService.deleteUser(params.id, query.userRealmName);
      return { ok: true, id: params.id };
    },
  });

  /**
   * Request a password reset.
   * Generates a reset token using verification service and sends an email to the user.
   */
  public requestPasswordReset = $action({
    path: "/users/password-reset/request",
    group: this.group,
    schema: {
      query: t.object({
        userRealmName: t.optional(t.string()),
      }),
      body: t.object({
        email: t.email(),
        resetUrl: t.string(),
      }),
      response: t.object({
        success: t.boolean(),
        message: t.string(),
      }),
    },
    handler: async ({ body, query }) => {
      await this.credentialService.requestPasswordReset(
        body.email,
        body.resetUrl,
        query.userRealmName,
      );

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
    group: this.group,
    schema: {
      query: t.object({
        email: t.email(),
        token: t.string(),
        userRealmName: t.optional(t.string()),
      }),
      response: t.object({
        valid: t.boolean(),
        email: t.optional(t.email()),
      }),
    },
    handler: async ({ query }) => {
      try {
        const email = await this.credentialService.validateResetToken(
          query.email,
          query.token,
          query.userRealmName,
        );
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
    group: this.group,
    schema: {
      query: t.object({
        userRealmName: t.optional(t.string()),
      }),
      body: t.object({
        email: t.email(),
        token: t.string(),
        newPassword: t.string({ minLength: 8 }),
      }),
      response: t.object({
        success: t.boolean(),
        message: t.string(),
      }),
    },
    handler: async ({ body, query }) => {
      await this.credentialService.resetPassword(
        body.email,
        body.token,
        body.newPassword,
        query.userRealmName,
      );

      return {
        success: true,
        message: "Password has been reset successfully. Please log in.",
      };
    },
  });

  /**
   * Request email verification.
   * Generates a verification token using verification service and sends an email to the user.
   */
  public requestEmailVerification = $action({
    path: "/users/email-verification/request",
    group: this.group,
    schema: {
      query: t.object({
        userRealmName: t.optional(t.string()),
      }),
      body: t.object({
        email: t.email(),
        verifyUrl: t.string(),
      }),
      response: t.object({
        success: t.boolean(),
        message: t.string(),
      }),
    },
    handler: async ({ body, query }) => {
      await this.userService.requestEmailVerification(
        body.email,
        body.verifyUrl,
        query.userRealmName,
      );

      return {
        success: true,
        message:
          "If an account exists with this email, a verification link has been sent.",
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
      query: t.object({
        userRealmName: t.optional(t.string()),
      }),
      body: t.object({
        email: t.email(),
        token: t.string(),
      }),
      response: t.object({
        success: t.boolean(),
        message: t.string(),
      }),
    },
    handler: async ({ body, query }) => {
      await this.userService.verifyEmail(body.email, body.token, query.userRealmName);

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
    schema: {
      query: t.object({
        email: t.email(),
        userRealmName: t.optional(t.string()),
      }),
      response: t.object({
        verified: t.boolean(),
      }),
    },
    handler: async ({ query }) => {
      const verified = await this.userService.isEmailVerified(query.email, query.userRealmName);

      return {
        verified,
      };
    },
  });
}
