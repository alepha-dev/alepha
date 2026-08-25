import { $inject, Alepha, AlephaError } from "alepha";
import { VerificationService } from "alepha/api/verifications";
import { DatabaseCacheProvider } from "alepha/cache/database";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { SecurityProvider } from "alepha/security";
import { BadRequestError } from "alepha/server";

import { UserNotifications } from "../notifications/UserNotifications.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";
import { TotpService } from "./TotpService.ts";

/**
 * The second factor a user has to clear after their password.
 *
 * `passkey` is deliberately absent: WebAuthn needs a server-issued challenge
 * of its own, so it will arrive as a third verifier rather than by widening
 * this union quietly.
 */
export type SecondFactorMethod = "totp" | "emailCode";

/**
 * Identity provider name used for the TOTP enrollment row. TOTP is not a way
 * to log in, so it is stored as an identity row rather than registered as an
 * `$auth` provider: `authenticationProviderSchema.type` only admits
 * `OAUTH2 | OIDC | CREDENTIALS`, and a login page would otherwise render a
 * nonsensical "Continue with totp" button.
 */
export const TOTP_PROVIDER = "totp";

/**
 * Verification bucket for second-factor email codes.
 *
 * A purpose of its own so the cooldown and daily-limit windows do not
 * collide with email verification or password reset on the same address.
 */
export const MFA_PURPOSE = "mfa";

/**
 * What is kept in `identities.providerData` for a TOTP enrollment.
 *
 * Everything lives in the existing JSON column so that adding a second factor
 * costs no migration, which in turn means no risk of a `DROP TABLE` cascade
 * on D1.
 */
export interface TotpIdentityData {
  /**
   * The shared secret, encrypted at rest with the application secret.
   */
  secret: string;

  /**
   * `pending` until the user proves they can produce a code. A pending
   * enrollment never gates a login.
   */
  status: "pending" | "active";

  /**
   * The last time step accepted for this identity. A step is single use, so
   * a code observed over someone's shoulder cannot be replayed inside its
   * own validity window.
   */
  lastUsedStep?: number;

  /**
   * Hashed single-use recovery codes. Plain SHA-256 without a salt is right
   * here and wrong for passwords: these are 80 bits of server-generated
   * randomness, so there is no dictionary to attack.
   */
  recoveryCodes: string[];

  activatedAt?: string;
}

/**
 * Second-factor enrollment and verification for a realm.
 *
 * Owns the "does this user need a second factor, and did they clear it"
 * question. The login route reaches this through the `realm.secondFactor`
 * seam rather than importing it, so `alepha/server/auth` stays free of any
 * dependency on `alepha/api/users`.
 */
export class MfaService {
  protected readonly log = $logger();
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly totp = $inject(TotpService);
  protected readonly security = $inject(SecurityProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly alepha = $inject(Alepha);
  protected readonly verificationService = $inject(VerificationService);
  protected readonly cacheProvider = $inject(DatabaseCacheProvider);

  /**
   * The notifications service, but only for a realm that opted into it.
   * Mirrors `CredentialService.userNotifications`.
   */
  protected userNotifications(realmName?: string) {
    const realm = this.realmProvider.getRealm(realmName);
    if (realm.features.notifications) {
      return this.alepha.inject(UserNotifications);
    }
    return undefined;
  }

  /**
   * How many recovery codes are handed out on activation. Ten is the common
   * choice, and enough that a user who prints them is unlikely to run out
   * before noticing.
   */
  protected static readonly RECOVERY_CODE_COUNT = 10;

  protected identities(realm?: string) {
    return this.realmProvider.identityRepository(realm);
  }

  /**
   * Which second factors this user must clear.
   *
   * An empty list means the password was enough. A pending TOTP enrollment
   * counts for nothing: the user has not yet proved they can produce a code,
   * and gating on it would lock them out of their own account.
   */
  public async methodsFor(
    userId: string,
    realm?: string,
  ): Promise<SecondFactorMethod[]> {
    const settings = await this.realmProvider.getRealm(realm).getSettings();
    const methods: SecondFactorMethod[] = [];

    if (settings.mfa.totp !== "disabled") {
      const identity = await this.findTotpIdentity(userId, realm);
      if (identity && this.dataOf(identity).status === "active") {
        methods.push(TOTP_PROVIDER);
      }
    }

    // TOTP wins when both are available: it is the stronger factor, and
    // offering the weaker one alongside it would let an attacker downgrade.
    if (methods.length === 0 && settings.mfa.emailCode !== "disabled") {
      const user = await this.realmProvider
        .userRepository(realm)
        .findById(userId);
      if (user?.email && user.emailVerified) {
        methods.push("emailCode");
      }
    }

    return methods;
  }

  /**
   * What the account page needs to render the two-factor section.
   */
  public async statusFor(
    userId: string,
    realm?: string,
  ): Promise<{
    totp: { enabled: boolean; pending: boolean; recoveryCodesLeft: number };
  }> {
    const identity = await this.findTotpIdentity(userId, realm);
    const data = identity ? this.dataOf(identity) : undefined;

    return {
      totp: {
        enabled: data?.status === "active",
        pending: data?.status === "pending",
        recoveryCodesLeft: data?.recoveryCodes.length ?? 0,
      },
    };
  }

  /**
   * Start a TOTP enrollment and return everything the user needs to scan.
   *
   * The secret is returned in clear exactly once, here. It is stored
   * encrypted, so nothing can ever show it again, which is the property that
   * makes a stolen database dump useless on its own.
   */
  public async beginTotpEnrollment(
    userId: string,
    realm?: string,
  ): Promise<{ secret: string; uri: string; qrSvg: string }> {
    const realmName = this.realmProvider.getRealm(realm).name;
    const user = await this.realmProvider
      .userRepository(realm)
      .findById(userId);

    if (!user) {
      throw new BadRequestError("User not found");
    }

    const existing = await this.findTotpIdentity(userId, realm);
    if (existing && this.dataOf(existing).status === "active") {
      throw new BadRequestError(
        "Two-factor authentication is already enabled on this account",
      );
    }

    const secret = this.totp.generateSecret();
    const data: TotpIdentityData = {
      secret: this.encryptSecret(secret),
      status: "pending",
      recoveryCodes: [],
    };

    // Restarting an abandoned enrollment replaces the pending row rather than
    // adding a second one, so a user who scanned the wrong QR can simply
    // start again.
    if (existing) {
      await this.identities(realm).updateById(existing.id, {
        providerData: data as never,
      });
    } else {
      await this.identities(realm).create({
        userId,
        provider: TOTP_PROVIDER,
        providerData: data as never,
      });
    }

    const uri = this.totp.otpauthUri({
      secret,
      account: user.email || user.username || userId,
      issuer: realmName,
    });

    return { secret, uri, qrSvg: this.totp.qrSvg(uri) };
  }

  /**
   * Finish enrollment by proving the authenticator app is in sync.
   *
   * Returns the recovery codes, in clear, exactly once. They are stored
   * hashed, so this is the only moment they can be shown.
   */
  public async activateTotp(
    userId: string,
    code: string,
    realm?: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const identity = await this.findTotpIdentity(userId, realm);

    if (!identity) {
      throw new BadRequestError("No pending two-factor enrollment to confirm");
    }

    const data = this.dataOf(identity);
    if (data.status === "active") {
      throw new BadRequestError(
        "Two-factor authentication is already enabled on this account",
      );
    }

    const step = this.totp.verify(this.decryptSecret(data.secret), code);
    if (step === undefined) {
      throw new BadRequestError("That code is not valid");
    }

    const recoveryCodes = this.generateRecoveryCodes();

    await this.identities(realm).updateById(identity.id, {
      providerData: {
        ...data,
        status: "active",
        // The activation code is burned with the enrollment: without this the
        // very code just typed stays usable for its remaining window.
        lastUsedStep: step,
        recoveryCodes: recoveryCodes.map((it) => this.crypto.hash(it)),
        activatedAt: this.dateTime.now().toISOString(),
      } as never,
    });

    return { recoveryCodes };
  }

  /**
   * Turn TOTP off for an account, dropping the secret and every recovery
   * code with it.
   */
  public async disableTotp(userId: string, realm?: string): Promise<void> {
    const identity = await this.findTotpIdentity(userId, realm);
    if (!identity) {
      return;
    }
    await this.identities(realm).deleteById(identity.id);
  }

  /**
   * Issue fresh recovery codes, invalidating whatever the user had before.
   */
  public async regenerateRecoveryCodes(
    userId: string,
    realm?: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const identity = await this.findTotpIdentity(userId, realm);
    const data = identity ? this.dataOf(identity) : undefined;

    if (!identity || !data || data.status !== "active") {
      throw new BadRequestError(
        "Two-factor authentication is not enabled on this account",
      );
    }

    const recoveryCodes = this.generateRecoveryCodes();
    await this.identities(realm).updateById(identity.id, {
      providerData: {
        ...data,
        recoveryCodes: recoveryCodes.map((it) => this.crypto.hash(it)),
      } as never,
    });

    return { recoveryCodes };
  }

  /**
   * Begin a factor.
   *
   * A no-op for TOTP, whose code is produced on the user's own device. For
   * email it creates the verification record and sends the message, and
   * reports back a masked destination for the UI to show.
   */
  public async start(
    userId: string,
    method: SecondFactorMethod,
    realm?: string,
  ): Promise<{ sentTo?: string }> {
    if (method === TOTP_PROVIDER) {
      return {};
    }

    const user = await this.realmProvider
      .userRepository(realm)
      .findById(userId);
    if (!user?.email) {
      throw new BadRequestError("This account has no email address");
    }

    try {
      const verification = await this.verificationService.createVerification({
        type: "code",
        target: user.email,
        purpose: MFA_PURPOSE,
      });

      await this.userNotifications(realm)?.mfaCode.push({
        contact: user.email,
        variables: {
          email: user.email,
          code: verification.token,
          expiresInMinutes: Math.floor(verification.codeExpiration / 60),
        },
      });
    } catch (error) {
      // `createVerification` refuses while a fresh code is still on cooldown.
      // That must not fail the sign-in: the code the user already has is
      // still valid, and turning the cooldown into an error would let anyone
      // holding a password lock the account out of its own second factor.
      this.log.debug("Reusing the second-factor code already sent", { error });
    }

    return { sentTo: this.maskEmail(user.email) };
  }

  /**
   * Hide most of an address while leaving it recognisable to its owner.
   */
  protected maskEmail(email: string): string {
    const [local, domain] = email.split("@");
    if (!local || !domain) {
      return "***";
    }
    return `${local.slice(0, 1)}${"*".repeat(Math.max(local.length - 1, 1))}@${domain}`;
  }

  /**
   * Check a submitted code against a user's second factor.
   *
   * Returns a plain boolean rather than throwing, because the caller has to
   * treat every failure identically: telling a caller *why* a code was
   * refused tells an attacker which half of the guess was right.
   */
  public async verify(
    userId: string,
    method: SecondFactorMethod,
    code: string,
    realm?: string,
  ): Promise<boolean> {
    const settings = await this.realmProvider.getRealm(realm).getSettings();
    const { accountMaxAttempts, windowMs } = settings.loginRateLimit;
    const key = `mfa:${realm ?? "default"}:${userId}`;

    // A six-digit code is a one-in-a-million guess, which is only tolerable
    // while the number of guesses is bounded. Its own counter, separate from
    // the password one: a user who mistypes codes must not spend the budget
    // that protects their password, and vice versa.
    if (await this.isLocked(key, accountMaxAttempts)) {
      this.log.warn("Second factor blocked, too many attempts", { userId });
      return false;
    }

    const passed =
      method === TOTP_PROVIDER
        ? await this.verifyTotp(userId, code, realm)
        : await this.verifyEmailCode(userId, code, realm);

    if (!passed) {
      await this.recordFailure(key, windowMs);
    }

    return passed;
  }

  protected static readonly RATE_LIMIT_CACHE = "mfa-rate-limit";

  /**
   * Fails closed, for the same reason `SessionService.isLoginLocked` does: a
   * counter store that cannot be read cannot report an attacker as under the
   * threshold, and answering "not locked" would turn an outage into an open
   * door.
   */
  protected async isLocked(key: string, max: number): Promise<boolean> {
    try {
      const count = await this.cacheProvider.getTyped<number>(
        MfaService.RATE_LIMIT_CACHE,
        key,
      );
      return count != null && count >= max;
    } catch (error) {
      this.log.error("Could not read the second-factor attempt count", error);
      return true;
    }
  }

  protected async recordFailure(key: string, windowMs: number): Promise<void> {
    try {
      await this.cacheProvider.incr(
        MfaService.RATE_LIMIT_CACHE,
        key,
        1,
        windowMs,
      );
    } catch (error) {
      // Swallowed: the attempt is being refused either way, and the door this
      // would leave open is closed by `isLocked` failing closed.
      this.log.error("Could not record a failed second-factor attempt", error);
    }
  }

  /**
   * Check a code that was emailed.
   *
   * `alreadyVerified` is treated as a failure on purpose. `verifyCode`
   * reports it as a success, which is right when confirming an address and
   * wrong for a login factor: it would let a single intercepted code clear a
   * second sign-in inside the same lifetime.
   */
  protected async verifyEmailCode(
    userId: string,
    code: string,
    realm?: string,
  ): Promise<boolean> {
    const user = await this.realmProvider
      .userRepository(realm)
      .findById(userId);
    if (!user?.email) {
      return false;
    }

    try {
      const result = await this.verificationService.verifyCode(
        { type: "code", target: user.email, purpose: MFA_PURPOSE },
        code,
      );
      return result.ok === true && result.alreadyVerified !== true;
    } catch (error) {
      // Expired, locked, or simply wrong: all the same from out here.
      this.log.debug("Second-factor email code refused", { error });
      return false;
    }
  }

  protected async verifyTotp(
    userId: string,
    code: string,
    realm?: string,
  ): Promise<boolean> {
    const identity = await this.findTotpIdentity(userId, realm);
    if (!identity) {
      return false;
    }

    const data = this.dataOf(identity);
    if (data.status !== "active") {
      return false;
    }

    const step = this.totp.verify(this.decryptSecret(data.secret), code);

    if (step !== undefined) {
      // A step is single use. Without this, a code stays replayable for the
      // whole drift window it was accepted in.
      if (data.lastUsedStep !== undefined && step <= data.lastUsedStep) {
        this.log.warn("Rejected a replayed TOTP code", { userId });
        return false;
      }

      await this.identities(realm).updateById(identity.id, {
        providerData: { ...data, lastUsedStep: step } as never,
      });
      return true;
    }

    return this.consumeRecoveryCode(identity.id, data, code, realm);
  }

  /**
   * Spend a recovery code, if the submitted value is one.
   *
   * Codes are removed as they are used, so each works exactly once.
   */
  protected async consumeRecoveryCode(
    identityId: string,
    data: TotpIdentityData,
    code: string,
    realm?: string,
  ): Promise<boolean> {
    const normalized = code.trim().toLowerCase().replace(/\s/g, "");
    const hashed = this.crypto.hash(normalized);

    const remaining = data.recoveryCodes.filter(
      (candidate) => !this.crypto.equals(candidate, hashed),
    );

    if (remaining.length === data.recoveryCodes.length) {
      return false;
    }

    await this.identities(realm).updateById(identityId, {
      providerData: { ...data, recoveryCodes: remaining } as never,
    });

    this.log.info("A recovery code was used to pass two-factor", {
      remaining: remaining.length,
    });

    return true;
  }

  protected generateRecoveryCodes(): string[] {
    return Array.from({ length: MfaService.RECOVERY_CODE_COUNT }, () =>
      // Grouped for legibility: these get written down and typed back in.
      `${this.crypto.randomText(5)}-${this.crypto.randomText(5)}`.toLowerCase(),
    );
  }

  protected async findTotpIdentity(userId: string, realm?: string) {
    return this.identities(realm).findOne({
      where: { userId: { eq: userId }, provider: { eq: TOTP_PROVIDER } },
    });
  }

  protected dataOf(identity: { providerData?: unknown }): TotpIdentityData {
    const data = identity.providerData as TotpIdentityData | undefined;
    if (!data?.secret) {
      throw new AlephaError("TOTP identity row carries no secret");
    }
    // A row written before recovery codes existed has none, and reading it
    // must not blow up on the caller.
    return { ...data, recoveryCodes: data.recoveryCodes ?? [] };
  }

  protected encryptSecret(secret: string): string {
    return this.crypto.encrypt(secret, this.security.secretKey);
  }

  protected decryptSecret(secret: string): string {
    return this.crypto.decrypt(secret, this.security.secretKey);
  }
}
