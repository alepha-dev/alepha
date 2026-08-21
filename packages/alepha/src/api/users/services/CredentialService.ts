import { $inject, Alepha } from "alepha";
import { VerificationService } from "alepha/api/verifications";
import { $cache } from "alepha/cache";
import { DatabaseCacheProvider } from "alepha/cache/database";
import { CaptchaProvider } from "alepha/captcha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { CryptoProvider } from "alepha/security";
import { BadRequestError, HttpError } from "alepha/server";

import type { RealmAuthSettings } from "../atoms/realmAuthSettingsAtom.ts";
import { SessionAudits } from "../audits/SessionAudits.ts";
import { UserAudits } from "../audits/UserAudits.ts";
import { UserNotifications } from "../notifications/UserNotifications.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";
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

/** Password-reset requests allowed per IP per 15-minute window. */
const RESET_IP_MAX_ATTEMPTS = 20;

const INTENT_TTL_MINUTES = 10;

/**
 * Verification purpose bucket for password-reset codes. Keeping this distinct
 * from the default bucket means a reset request is not rate-limited by an
 * unrelated email-verification code on the same address (e.g. a user who just
 * registered and immediately asks to reset their password).
 */
const PASSWORD_RESET_PURPOSE = "password-reset";

export class CredentialService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly cryptoProvider = $inject(CryptoProvider);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly verificationService = $inject(VerificationService);
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly captchaProvider = $inject(CaptchaProvider);

  protected userAudits(realmName?: string) {
    const realm = this.realmProvider.getRealm(realmName);
    if (realm.features.audits) {
      return this.alepha.inject(UserAudits);
    }
    return undefined;
  }

  protected sessionAudits(realmName?: string) {
    const realm = this.realmProvider.getRealm(realmName);
    if (realm.features.audits) {
      return this.alepha.inject(SessionAudits);
    }
    return undefined;
  }

  protected userNotifications(realmName?: string) {
    const realm = this.realmProvider.getRealm(realmName);
    if (realm.features.notifications) {
      return this.alepha.inject(UserNotifications);
    }
    return undefined;
  }

  protected readonly intentCache = $cache<PasswordResetIntent>({
    // Use the SQL-backed cache so phase-2 reads what phase-1 wrote with
    // strong consistency, and so bare deployments don't need a distributed
    // KV resource just to support password reset.
    provider: DatabaseCacheProvider,
    name: "api:users:password-reset-intents",
    ttl: [INTENT_TTL_MINUTES, "minutes"],
  });

  /**
   * Per-IP throttle for password-reset requests.
   *
   * The per-target cooldown and daily limit are scoped to
   * `(type, target, purpose)`, so one IP could request resets for thousands
   * of DISTINCT real addresses without ever tripping them — an email-bombing
   * primitive pointed at other people's inboxes. Registration already has
   * `registrationIpMaxAttempts`; this is the same idea for the reset flow.
   *
   * SQL-backed so `incr()` is atomic, matching RegistrationService.
   */
  protected readonly resetIpCache = $cache<number>({
    provider: DatabaseCacheProvider,
    name: "api:users:password-reset-ip-rate-limit",
    ttl: [15, "minutes"],
  });

  public users(userRealmName?: string) {
    return this.realmProvider.userRepository(userRealmName);
  }

  public sessions(userRealmName?: string) {
    return this.realmProvider.sessionRepository(userRealmName);
  }

  public identities(userRealmName?: string) {
    return this.realmProvider.identityRepository(userRealmName);
  }

  /**
   * Validate a password against the realm's password policy.
   */
  public validatePasswordPolicy(
    password: string,
    policy: RealmAuthSettings["passwordPolicy"],
  ): void {
    if (password.length < policy.minLength) {
      throw new BadRequestError(
        `Password must be at least ${policy.minLength} characters`,
      );
    }
    if (policy.requireUppercase && !/[A-Z]/.test(password)) {
      throw new BadRequestError(
        "Password must contain at least one uppercase letter",
      );
    }
    if (policy.requireLowercase && !/[a-z]/.test(password)) {
      throw new BadRequestError(
        "Password must contain at least one lowercase letter",
      );
    }
    if (policy.requireNumbers && !/\d/.test(password)) {
      throw new BadRequestError("Password must contain at least one number");
    }
    if (policy.requireSpecialCharacters && !/[^a-zA-Z0-9]/.test(password)) {
      throw new BadRequestError(
        "Password must contain at least one special character",
      );
    }
  }

  /**
   * Phase 1: Create a password reset intent.
   *
   * Validates the email, checks for existing user with credentials,
   * sends verification code, and stores the intent in cache.
   *
   * @param email - User's email address
   * @param userRealmName - Optional realm name
   * @param captchaToken - Captcha response, required when the realm sets `captchaRequired`
   * @returns Intent response with intentId and expiration (always returns for security)
   */
  public async createPasswordResetIntent(
    email: string,
    userRealmName?: string,
    captchaToken?: string,
  ): Promise<PasswordResetIntentResponse> {
    this.log.trace("Creating password reset intent", { email, userRealmName });

    // Generate intent ID and expiration upfront for consistent response
    const intentId = this.cryptoProvider.randomUUID();
    const expiresAt = this.dateTimeProvider
      .now()
      .add(INTENT_TTL_MINUTES, "minutes")
      .toISOString();

    // Per-IP cap, before any work. See `resetIpCache` for why the per-target
    // limits are not enough on their own.
    const request = this.alepha.store.get("alepha.http.request");
    if (request?.ip) {
      const attempts = await this.resetIpCache.incr(`reset:ip:${request.ip}`);
      if (attempts > RESET_IP_MAX_ATTEMPTS) {
        this.log.warn("Password reset rate limit exceeded", { ip: request.ip });
        // Same shape as the success path: never reveal whether the address
        // exists, and do not tell a prober they hit a limit either.
        return { intentId, expiresAt };
      }
    }

    // Check if password reset is allowed for this realm
    const realm = this.realmProvider.getRealm(userRealmName);
    const realmSettings = await realm.getSettings();

    // Validate captcha before the user lookup and the email send. The per-IP
    // cap above bounds a single origin, but says nothing about a botnet
    // spreading one request per address — and every accepted request here
    // sends mail in our name. Rejecting loudly leaks nothing: the answer
    // depends on the request shape, never on whether the account exists.
    if (realmSettings.captchaRequired === true) {
      if (!captchaToken) {
        throw new BadRequestError("Captcha verification is required");
      }
      const valid = await this.captchaProvider.verify(captchaToken);
      if (!valid) {
        throw new BadRequestError("Captcha verification failed");
      }
    }

    if (realmSettings.resetPasswordAllowed === false) {
      this.log.debug("Password reset not allowed for realm", { userRealmName });
      return { intentId, expiresAt };
    }

    // Find user by email (silent fail for security)
    const user = await this.users(userRealmName).findOne({
      where: { email: { eq: email } },
    });

    if (!user) {
      // Silent fail - don't reveal that email doesn't exist
      this.log.debug("Password reset requested for non-existent email", {
        email,
      });
      return { intentId, expiresAt };
    }

    // Find the credentials identity for this user
    const identity = await this.identities(userRealmName).findOne({
      where: {
        userId: { eq: user.id },
        provider: { eq: "credentials" },
      },
    });

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
      const verification = await this.verificationService.createVerification({
        type: "code",
        target: email,
        purpose: PASSWORD_RESET_PURPOSE,
      });

      // Send password reset notification with the code
      await this.userNotifications(userRealmName)?.passwordReset.push({
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

    // Validate password against realm policy before consuming the verification code
    const realm = this.realmProvider.getRealm(intent.realmName);
    const realmSettings = await realm.getSettings();
    this.validatePasswordPolicy(body.newPassword, realmSettings.passwordPolicy);

    // Verify code using verification service
    const result = await this.verificationService
      .verifyCode(
        {
          type: "code",
          target: intent.email,
          purpose: PASSWORD_RESET_PURPOSE,
        },
        body.code,
      )
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

    // Invalidate intent after all operations succeed,
    // so the user can retry if password update or session cleanup fails.
    // The verification code was already consumed (verifiedAt set), so replay is
    // prevented even if the intent is still in cache.
    await this.intentCache.invalidate(body.intentId);

    this.log.info("Password reset completed", {
      userId: intent.userId,
      email: intent.email,
    });

    // Audit: password reset
    await this.userAudits(intent.realmName)?.user.log("update", {
      resourceType: "user",
      userId: intent.userId,
      userEmail: intent.email,
      userRealm: realm.name,
      resourceId: intent.userId,
      description: "Password reset completed",
      metadata: { email: intent.email },
    });

    // Audit: sessions invalidated (security event)
    await this.sessionAudits(intent.realmName)?.security.log(
      "sessions_invalidated",
      {
        userId: intent.userId,
        userEmail: intent.email,
        userRealm: realm.name,
        resourceId: intent.userId,
        severity: "warning",
        description: "All sessions invalidated after password reset",
      },
    );
  }
}
