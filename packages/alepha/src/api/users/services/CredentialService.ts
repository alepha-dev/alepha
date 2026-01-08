import { randomUUID } from "node:crypto";
import { $inject } from "alepha";
import { AuditService } from "alepha/api/audits";
import type { VerificationController } from "alepha/api/verifications";
import { $cache } from "alepha/cache";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { CryptoProvider } from "alepha/security";
import { BadRequestError, HttpError } from "alepha/server";
import { $client } from "alepha/server/links";
import { UserNotifications } from "../notifications/UserNotifications.ts";
import { UserRealmProvider } from "../providers/UserRealmProvider.ts";
import type { CompletePasswordResetRequest } from "../schemas/completePasswordResetRequestSchema.ts";
import type { PasswordResetIntentResponse } from "../schemas/passwordResetIntentResponseSchema.ts";

/**
 * Intent stored in cache during the password reset flow.
 */
interface PasswordResetIntent {
  email: string;
  userId: string;
  identityId: string;
  realmName?: string;
  expiresAt: string;
}

const INTENT_TTL_MINUTES = 10;

export class CredentialService {
  protected readonly log = $logger();
  protected readonly cryptoProvider = $inject(CryptoProvider);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly verificationController = $client<VerificationController>();
  protected readonly userNotifications = $inject(UserNotifications);
  protected readonly userRealmProvider = $inject(UserRealmProvider);
  protected readonly auditService = $inject(AuditService);

  protected readonly intentCache = $cache<PasswordResetIntent>({
    name: "password-reset-intents",
    ttl: [INTENT_TTL_MINUTES, "minutes"],
  });

  public users(userRealmName?: string) {
    return this.userRealmProvider.userRepository(userRealmName);
  }

  public sessions(userRealmName?: string) {
    return this.userRealmProvider.sessionRepository(userRealmName);
  }

  public identities(userRealmName?: string) {
    return this.userRealmProvider.identityRepository(userRealmName);
  }

  /**
   * Phase 1: Create a password reset intent.
   *
   * Validates the email, checks for existing user with credentials,
   * sends verification code, and stores the intent in cache.
   *
   * @param email - User's email address
   * @param userRealmName - Optional realm name
   * @returns Intent response with intentId and expiration (always returns for security)
   */
  public async createPasswordResetIntent(
    email: string,
    userRealmName?: string,
  ): Promise<PasswordResetIntentResponse> {
    this.log.trace("Creating password reset intent", { email, userRealmName });

    // Generate intent ID and expiration upfront for consistent response
    const intentId = randomUUID();
    const expiresAt = this.dateTimeProvider
      .now()
      .add(INTENT_TTL_MINUTES, "minutes")
      .toISOString();

    // Find user by email (silent fail for security)
    const user = await this.users(userRealmName)
      .findOne({
        where: { email: { eq: email } },
      })
      .catch(() => undefined);

    if (!user) {
      // Silent fail - don't reveal that email doesn't exist
      this.log.debug("Password reset requested for non-existent email", {
        email,
      });
      return { intentId, expiresAt };
    }

    // Find the credentials identity for this user
    const identity = await this.identities(userRealmName)
      .findOne({
        where: {
          userId: { eq: user.id },
          provider: { eq: "credentials" },
        },
      })
      .catch(() => undefined);

    if (!identity) {
      // User doesn't have credentials identity (maybe OAuth only)
      this.log.debug("Password reset requested for user without credentials", {
        userId: user.id,
      });
      return { intentId, expiresAt };
    }

    // Create verification using verification controller
    // This handles: token generation, expiration, rate limiting, cooldown
    try {
      const verification =
        await this.verificationController.requestVerificationCode({
          params: { type: "code" },
          body: { target: email },
        });

      // Send password reset notification with the code
      await this.userNotifications.passwordReset.push({
        contact: email,
        variables: {
          email,
          code: verification.token,
          expiresInMinutes: Math.floor(verification.codeExpiration / 60),
        },
      });

      // Store intent in cache
      const intent: PasswordResetIntent = {
        email,
        userId: user.id,
        identityId: identity.id,
        realmName: userRealmName,
        expiresAt,
      };

      await this.intentCache.set(intentId, intent);

      this.log.info("Password reset intent created", {
        intentId,
        userId: user.id,
        email,
      });
    } catch (error) {
      // If rate limit or cooldown hit, still return success for security
      this.log.warn("Failed to create password reset verification", error);
    }

    return { intentId, expiresAt };
  }

  /**
   * Phase 2: Complete password reset using an intent.
   *
   * Validates the verification code, updates the password,
   * and invalidates all existing sessions.
   *
   * @param body - Request body with intentId, code, and newPassword
   */
  public async completePasswordReset(
    body: CompletePasswordResetRequest,
  ): Promise<void> {
    this.log.trace("Completing password reset", { intentId: body.intentId });

    // Fetch intent from cache
    const intent = await this.intentCache.get(body.intentId);
    if (!intent) {
      this.log.warn("Invalid or expired password reset intent", {
        intentId: body.intentId,
      });
      throw new HttpError({
        status: 410,
        message: "Invalid or expired password reset intent",
      });
    }

    // Verify code using verification controller
    const result = await this.verificationController
      .validateVerificationCode({
        params: { type: "code" },
        body: { target: intent.email, token: body.code },
      })
      .catch(() => {
        this.log.warn("Invalid verification code for password reset", {
          intentId: body.intentId,
          email: intent.email,
        });
        throw new BadRequestError("Invalid or expired verification code");
      });

    // If already verified, this is a code reuse attempt
    if (result.alreadyVerified) {
      this.log.warn("Verification code reuse attempt", {
        intentId: body.intentId,
        email: intent.email,
      });
      throw new BadRequestError("Verification code has already been used");
    }

    // Atomically delete cache key to prevent replay
    await this.intentCache.invalidate(body.intentId);

    // Hash the new password
    const hashedPassword = await this.cryptoProvider.hashPassword(
      body.newPassword,
    );

    // Update the identity with new password
    await this.identities(intent.realmName).updateById(intent.identityId, {
      password: hashedPassword,
    });

    // Invalidate all existing sessions for this user
    await this.sessions(intent.realmName).deleteMany({
      userId: { eq: intent.userId },
    });

    this.log.info("Password reset completed", {
      userId: intent.userId,
      email: intent.email,
    });

    const realm = this.userRealmProvider.getRealm(intent.realmName);

    // Audit: password reset
    await this.auditService.recordUser("update", {
      userId: intent.userId,
      userEmail: intent.email,
      userRealm: realm.name,
      resourceId: intent.userId,
      description: "Password reset completed",
      metadata: { email: intent.email },
    });

    // Audit: sessions invalidated (security event)
    await this.auditService.record("security", "sessions_invalidated", {
      userId: intent.userId,
      userEmail: intent.email,
      userRealm: realm.name,
      resourceId: intent.userId,
      severity: "warning",
      description: "All sessions invalidated after password reset",
    });
  }

  // Legacy methods kept for backward compatibility

  /**
   * @deprecated Use createPasswordResetIntent instead
   */
  public async requestPasswordReset(
    email: string,
    userRealmName?: string,
  ): Promise<boolean> {
    await this.createPasswordResetIntent(email, userRealmName);
    return true;
  }

  /**
   * @deprecated Use completePasswordReset instead
   */
  public async validateResetToken(
    email: string,
    token: string,
    _userRealmName?: string,
  ): Promise<string> {
    // Verify using verification controller
    const isValid = await this.verificationController
      .validateVerificationCode({
        params: { type: "code" },
        body: { target: email, token },
      })
      .catch(() => undefined);

    if (!isValid?.ok) {
      throw new BadRequestError("Invalid or expired reset token");
    }

    return email;
  }

  /**
   * @deprecated Use completePasswordReset instead
   */
  public async resetPassword(
    email: string,
    token: string,
    newPassword: string,
    userRealmName?: string,
  ): Promise<void> {
    // Verify token using verification controller
    const result = await this.verificationController
      .validateVerificationCode({
        params: { type: "code" },
        body: { target: email, token },
      })
      .catch(() => {
        throw new BadRequestError("Invalid or expired reset token");
      });

    // If already verified, this is a token reuse attempt
    if (result.alreadyVerified) {
      throw new BadRequestError("Invalid or expired reset token");
    }

    // Find user and identity
    const user = await this.users(userRealmName).findOne({
      where: { email: { eq: email } },
    });

    const identity = await this.identities(userRealmName).findOne({
      where: {
        userId: { eq: user.id },
        provider: { eq: "credentials" },
      },
    });

    // Hash the new password
    const hashedPassword = await this.cryptoProvider.hashPassword(newPassword);

    // Update the identity with new password
    await this.identities(userRealmName).updateById(identity.id, {
      password: hashedPassword,
    });

    // Invalidate all existing sessions for this user
    await this.sessions(userRealmName).deleteMany({
      userId: { eq: user.id },
    });

    const realm = this.userRealmProvider.getRealm(userRealmName);

    // Audit: password reset (legacy method)
    await this.auditService.recordUser("update", {
      userId: user.id,
      userEmail: email,
      userRealm: realm.name,
      resourceId: user.id,
      description: "Password reset completed (legacy)",
      metadata: { email },
    });

    // Audit: sessions invalidated
    await this.auditService.record("security", "sessions_invalidated", {
      userId: user.id,
      userEmail: email,
      userRealm: realm.name,
      resourceId: user.id,
      severity: "warning",
      description: "All sessions invalidated after password reset",
    });
  }
}
