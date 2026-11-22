import { $inject, Alepha } from "alepha";
import { VerificationService } from "alepha/api/verifications";
import { $cache } from "alepha/cache";
import { DatabaseCacheProvider } from "alepha/cache/database";
import { CaptchaProvider } from "alepha/captcha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $rateLimit } from "alepha/rate-limit";
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
  /**
   * The account and its password identity. Both absent on the intent of an
   * address with no account, or with no password to reset: it is stored all
   * the same, so that completing it answers what a wrong code answers.
   */
  userId?: string;
  identityId?: string;
  realmName?: string;
  expiresAt: string;
}

export class CredentialService {
  /**
   * Password-reset requests allowed per IP per 15-minute window.
   */
  protected readonly resetIpMaxAttempts = 20;

  /**
   * Per-IP cap on password-reset completions, in the same 15-minute window.
   *
   * Each completion is a guess at a 6-digit code. The code's own attempt
   * budget bounds guesses per code; this bounds what one address can throw
   * at the endpoint across intents.
   */
  protected readonly completeIpMaxAttempts = 30;

  protected readonly intentTtlMinutes = 10;

  /**
   * Verification purpose bucket for password-reset codes. Keeping this distinct
   * from the default bucket means a reset request is not rate-limited by an
   * unrelated email-verification code on the same address (e.g. a user who just
   * registered and immediately asks to reset their password).
   */
  protected readonly passwordResetPurpose = "password-reset";

  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly cryptoProvider = $inject(CryptoProvider);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly verificationService = $inject(VerificationService);
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly captchaProvider = $inject(CaptchaProvider);

  protected userAudits(realmName?: string) {
    // Registered by every `$realm` whatever its features say; a realm
    // registered straight through `RealmProvider` (tests) may not have it.
    if (this.alepha.has(UserAudits)) {
      return this.alepha.inject(UserAudits);
    }
    return undefined;
  }

  protected sessionAudits(realmName?: string) {
    // Registered by every `$realm` whatever its features say; a realm
    // registered straight through `RealmProvider` (tests) may not have it.
    if (this.alepha.has(SessionAudits)) {
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
    ttl: [this.intentTtlMinutes, "minutes"],
  });

  /**
   * Per-IP throttle for password-reset requests.
   *
   * The per-target cooldown and daily limit are scoped to
   * `(type, target, purpose)`, so one IP could request resets for thousands
   * of DISTINCT real addresses without ever tripping them, an email-bombing
   * primitive pointed at other people's inboxes. Registration already has
   * `registrationIpMaxAttempts`; this is the same idea for the reset flow.
   *
   * Counted, then compared; never refunded.
   */
  protected readonly resetIp = $rateLimit({
    name: "password-reset:ip",
    limit: this.resetIpMaxAttempts,
    window: [15, "minutes"],
  });

  /**
   * Per-IP throttle for password-reset completions. Its own bucket, so a
   * user who requested a few resets is not locked out of completing one.
   */
  protected readonly completeIp = $rateLimit({
    name: "password-reset-complete:ip",
    limit: this.completeIpMaxAttempts,
    window: [15, "minutes"],
  });

  /**
   * Which per-IP bucket a request is counted against. A request with no
   * client address (no `TRUST_PROXY` on a runtime with no socket) shares one
   * bucket, as `SessionService.ipBucket` does for the login: no address is
   * not a reason to skip the budget. A call with no HTTP request at all (a
   * script, a spec) is not counted.
   */
  protected ipBucket(request: { ip?: string } | undefined): string | undefined {
    if (!request) return undefined;
    if (request.ip) return request.ip;
    this.log.warn(
      "Password reset with no client address; counting it against the shared bucket. Set TRUST_PROXY if this app is behind a proxy.",
    );
    return "unknown";
  }

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
   * @returns Intent response with intentId and expiration, the same whether
   * or not the address has an account. Throws on a refused captcha and on a
   * counter store outage (503).
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
      .add(this.intentTtlMinutes, "minutes")
      .toISOString();

    // Per-IP cap, before any work. See `resetIp` for why the per-target
    // limits are not enough on their own.
    const request = this.alepha.store.get("alepha.http.request");
    const bucket = this.ipBucket(request);
    if (bucket) {
      const attempt = await this.resetIp.consume(bucket);
      // An outage answers 503: a silent "success" would lie to a real user,
      // and a 503 says nothing about the address.
      if (attempt.reason === "store" && !attempt.allowed)
        throw new HttpError(
          { status: 503 },
          { message: "Password reset is temporarily unavailable" },
        );
      if (!attempt.allowed) {
        this.log.warn("Password reset rate limit exceeded", { ip: bucket });
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
    // spreading one request per address, and every accepted request here
    // sends mail in our name. Rejecting loudly leaks nothing: the answer
    // depends on the request shape, never on whether the account exists.
    if (realmSettings.captchaRequired === true) {
      if (!captchaToken) {
        throw new BadRequestError("Captcha verification is required");
      }
      // The client address goes with it: Turnstile binds a token to the
      // address that solved it, and cannot check that unless it is told.
      const valid = await this.captchaProvider.verify(
        captchaToken,
        request?.ip,
      );
      if (!valid) {
        throw new BadRequestError("Captcha verification failed");
      }
    }

    if (realmSettings.resetPasswordAllowed === false) {
      this.log.debug("Password reset not allowed for realm", { userRealmName });
      return { intentId, expiresAt };
    }

    // Find user by email (silent fail for security), within this realm only:
    // the same address may exist in another realm with its own policy.
    const user = await this.users(userRealmName).findOne({
      where: {
        realm: { eq: this.realmProvider.getRealm(userRealmName).name },
        email: { eq: email },
      },
    });

    // The credentials identity of this user, if any.
    const identity = user
      ? await this.identities(userRealmName).findOne({
          where: {
            userId: { eq: user.id },
            provider: { eq: "credentials" },
          },
        })
      : undefined;

    // An intent is stored in every case from here on: for an address with no
    // account, an account with no password, and a verification that could
    // not be created (cooldown, daily cap). Completing an intent that was
    // never stored answers 410, and that status used to tell an existing
    // account from an unknown address.
    await this.intentCache.set(intentId, {
      email,
      userId: identity ? user?.id : undefined,
      identityId: identity?.id,
      realmName: userRealmName,
      expiresAt,
    });

    if (!user || !identity) {
      // No mail and no code: completing this intent fails on the code check.
      this.log.debug(
        "Password reset requested for an address with no password",
        {
          email,
        },
      );
      return { intentId, expiresAt };
    }

    // Create the verification through `VerificationService`, which handles
    // token generation, expiration, rate limiting and cooldown.
    try {
      const verification = await this.verificationService.createVerification({
        type: "code",
        target: email,
        purpose: this.passwordResetPurpose,
      });

      // Send password reset notification with the code.
      //
      // `inline` here buys the half of the flag that survives the catch
      // below. It has two effects: the caller hears about a failure, and a
      // failed send is written TERMINAL instead of `scheduled`. Only the
      // second one reaches this path, and it is the one that matters: the
      // code lives 300 seconds and the sweep runs every 900, so without it a
      // retry is guaranteed to deliver an expired code some minutes later.
      //
      // The first effect is given up on purpose. This endpoint answers an
      // unauthenticated caller who typed an arbitrary address, and the whole
      // function is built to answer identically whether or not that address
      // is on file. Letting a send failure escape would make an error mean
      // "that account exists".
      await this.userNotifications(userRealmName)?.passwordReset.push({
        contact: email,
        variables: {
          email,
          code: verification.token,
          expiresInMinutes: Math.floor(verification.codeExpiration / 60),
        },
        inline: true,
      });

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

    // Per-IP cap, before any work. See `completeIp`.
    const request = this.alepha.store.get("alepha.http.request");
    const bucket = this.ipBucket(request);
    if (bucket) {
      const attempt = await this.completeIp.consume(bucket);
      if (attempt.reason === "store" && !attempt.allowed)
        throw new HttpError(
          { status: 503 },
          { message: "Password reset is temporarily unavailable" },
        );
      if (!attempt.allowed) {
        this.log.warn("Password reset completion rate limit exceeded", {
          ip: bucket,
        });
        throw new HttpError(
          { status: 429 },
          {
            message: "Too many password reset attempts, please try again later",
          },
        );
      }
    }

    // Fetch intent from cache
    const intent = await this.intentCache.get(body.intentId);
    if (!intent) {
      this.log.warn("Invalid or expired password reset intent", {
        intentId: body.intentId,
      });
      throw new HttpError(
        { status: 410 },
        { message: "Invalid or expired password reset intent" },
      );
    }

    // Validate the password against the realm policy before consuming the
    // verification code, so a refused password does not cost the code. Every
    // address has an intent, so this answers the same for all of them.
    const realm = this.realmProvider.getRealm(intent.realmName);
    const realmSettings = await realm.getSettings();
    this.validatePasswordPolicy(body.newPassword, realmSettings.passwordPolicy);

    // Verify code using verification service
    const result = await this.verificationService
      .verifyCode(
        {
          type: "code",
          target: intent.email,
          purpose: this.passwordResetPurpose,
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

    // An intent that names no password identity can never complete.
    if (!intent.userId || !intent.identityId) {
      throw new BadRequestError("Invalid or expired verification code");
    }

    // Hash the new password
    const hashedPassword = await this.cryptoProvider.hashPassword(
      body.newPassword,
    );

    // Update the identity with new password. A reset by email is the user
    // choosing their own password, so it clears a temporary-password mark.
    const identities = this.identities(intent.realmName);
    const identity = await identities.findById(intent.identityId);
    await identities.updateById(intent.identityId, {
      password: hashedPassword,
      providerData: {
        ...(identity?.providerData as Record<string, unknown> | undefined),
        mustChangePassword: false,
      },
    });

    // The code reached the address on file, so the reset proves it
    // (#Q4096, the owner's decision of 2026-11-22). Only while the account
    // still holds that address: one changed since the intent was made
    // proves nothing.
    const owner = await this.users(intent.realmName).findById(intent.userId);
    if (owner && owner.email === intent.email && !owner.emailVerified) {
      await this.users(intent.realmName).updateById(owner.id, {
        emailVerified: true,
      });
    }

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
