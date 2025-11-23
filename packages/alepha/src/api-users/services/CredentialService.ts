import { $inject } from "alepha";
import type { VerificationController } from "alepha/api/verifications";
import { CryptoProvider } from "alepha/security";
import { BadRequestError } from "alepha/server";
import { $client } from "alepha/server/links";
import { UserNotifications } from "../notifications/UserNotifications.ts";
import { UserRealmProvider } from "../providers/UserRealmProvider.ts";

export class CredentialService {
  protected readonly cryptoProvider = $inject(CryptoProvider);
  protected readonly verificationController = $client<VerificationController>();
  protected readonly userNotifications = $inject(UserNotifications);
  protected readonly userRealmProvider = $inject(UserRealmProvider);

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
   * Request a password reset for a user by email.
   * Uses the verification service for secure token generation and management.
   *
   * @param email - User's email address
   * @returns True if reset was initiated (regardless of whether user exists - for security)
   */
  public async requestPasswordReset(
    email: string,
    userRealmName?: string,
  ): Promise<boolean> {
    // Find user by email (silent fail for security)
    const user = await this.users(userRealmName)
      .findOne({
        where: { email: { eq: email } },
      })
      .catch(() => undefined);

    if (!user) {
      // Silent fail - don't reveal that email doesn't exist
      return true;
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
      // Silent fail - don't reveal this information
      return true;
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
    } catch {
      // If rate limit or cooldown hit, still return true for security
      // The error will be logged but not exposed to user
    }

    return true;
  }

  /**
   * Validate a password reset token.
   * Returns email if valid, throws error if invalid/expired.
   */
  public async validateResetToken(
    email: string,
    token: string,
    userRealmName?: string,
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
   * Reset a user's password using a valid reset token.
   * Validates token, updates password, and invalidates all sessions.
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
  }
}
