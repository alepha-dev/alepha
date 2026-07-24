import { createHash, randomInt } from "node:crypto";
import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";
import {
  type VerificationEntity,
  verifications,
} from "../entities/verifications.ts";
import { VerificationParameters } from "../parameters/VerificationParameters.ts";
import type { RequestVerificationResponse } from "../schemas/requestVerificationCodeResponseSchema.ts";
import type { ValidateVerificationCodeResponse } from "../schemas/validateVerificationCodeResponseSchema.ts";
import type { VerificationTypeEnum } from "../schemas/verificationTypeEnumSchema.ts";

export class VerificationService {
  protected readonly log = $logger();
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly verificationParameters = $inject(VerificationParameters);
  protected readonly verificationRepository = $repository(verifications);

  public async findByEntry(
    entry: VerificationEntry,
  ): Promise<VerificationEntity> {
    this.log.trace("Finding verification by entry", {
      type: entry.type,
      target: entry.target,
    });

    const results = await this.verificationRepository.findMany({
      limit: 1, // only need the most recent entry
      orderBy: {
        column: "createdAt",
        direction: "desc",
      },
      where: {
        type: { eq: entry.type },
        target: { eq: entry.target },
        purpose: { eq: entry.purpose ?? "default" },
      },
    });

    if (results.length === 0) {
      this.log.debug("Verification entry not found", {
        type: entry.type,
        target: entry.target,
      });
      throw new NotFoundError("Verification entry not found");
    }

    this.log.debug("Verification entry found", {
      id: results[0].id,
      type: entry.type,
      target: entry.target,
    });

    return results[0];
  }

  public findRecentsByEntry(entry: VerificationEntry) {
    this.log.trace("Finding recent verifications by entry", {
      type: entry.type,
      target: entry.target,
    });

    return this.verificationRepository.findMany({
      orderBy: {
        column: "createdAt",
        direction: "desc",
      },
      where: {
        type: { eq: entry.type },
        target: { eq: entry.target },
        purpose: { eq: entry.purpose ?? "default" },
        createdAt: {
          gte: this.dateTimeProvider.now().startOf("day").toISOString(),
        },
      },
    });
  }

  /**
   * Creates a verification entry and returns the token.
   * The caller is responsible for sending notifications with the token.
   * This allows for context-specific notifications (e.g., password reset vs email verification).
   */
  public async createVerification(
    entry: VerificationEntry,
  ): Promise<RequestVerificationResponse> {
    this.log.trace("Creating verification", {
      type: entry.type,
      target: entry.target,
    });

    const settings = this.verificationParameters.get(entry.type);

    const recents = await this.findRecentsByEntry(entry);
    if (recents.length >= settings.limitPerDay) {
      this.log.warn("Daily verification limit reached", {
        type: entry.type,
        target: entry.target,
        limit: settings.limitPerDay,
        count: recents.length,
      });
      throw new BadRequestError(
        `Maximum number of verification requests per day reached (${settings.limitPerDay})`,
      );
    }

    const existingVerification = recents[0];
    if (existingVerification) {
      const nowSec = this.dateTimeProvider.now().unix();
      const createdAtSec = this.dateTimeProvider
        .of(existingVerification.createdAt)
        .unix();

      const diffSec = nowSec - createdAtSec;
      if (diffSec < settings.verificationCooldown) {
        const remainingCooldown = Math.floor(
          settings.verificationCooldown - diffSec,
        );
        this.log.debug("Verification on cooldown", {
          type: entry.type,
          target: entry.target,
          remainingSeconds: remainingCooldown,
        });
        throw new BadRequestError(
          `Verification is on cooldown for ${remainingCooldown} seconds`,
        );
      }
    }

    const token = this.generateToken(entry.type);

    const verification = await this.verificationRepository.create({
      type: entry.type,
      target: entry.target,
      purpose: entry.purpose ?? "default",
      code: this.hashCode(token),
      createdAt: this.dateTimeProvider.nowISOString(),
    });

    this.log.info("Verification created", {
      id: verification.id,
      type: entry.type,
      target: entry.target,
      expiresInSeconds: settings.codeExpiration,
    });

    return {
      token,
      codeExpiration: settings.codeExpiration,
      verificationCooldown: settings.verificationCooldown,
      maxVerificationAttempts: settings.maxAttempts,
    };
  }

  public async verifyCode(
    entry: VerificationEntry,
    code: string,
  ): Promise<ValidateVerificationCodeResponse> {
    this.log.trace("Verifying code", {
      type: entry.type,
      target: entry.target,
    });

    const settings = this.verificationParameters.get(entry.type);

    const verification = await this.findByEntry(entry);
    if (verification.verifiedAt) {
      // Already verified — but STILL require the submitted code to match the
      // record. Short-circuiting on `verifiedAt` alone means any code (or a
      // blank one) passes once the target has been verified, so any flow
      // re-using verifyCode as an authz gate would accept an attacker's guess.
      //
      // Wrong guesses burn the same attempt budget as unverified records —
      // without the counter this branch is brute-forceable forever.
      if (verification.attempts >= settings.maxAttempts) {
        this.log.warn("Verification locked due to max attempts", {
          id: verification.id,
          type: entry.type,
          target: entry.target,
        });
        throw new BadRequestError(
          "Maximum number of attempts reached - verification is locked",
        );
      }
      if (verification.code !== this.hashCode(code)) {
        await this.verificationRepository.updateById(verification.id, {
          attempts: verification.attempts + 1,
        });
        this.log.warn("Invalid code submitted for already-verified entry", {
          id: verification.id,
          type: entry.type,
          target: entry.target,
        });
        throw new BadRequestError("Invalid verification code");
      }
      this.log.debug("Verification already verified", {
        id: verification.id,
        type: entry.type,
        target: entry.target,
        verifiedAt: verification.verifiedAt,
      });
      return { ok: true, alreadyVerified: true };
    }

    // DO NOT DELETE THE VERIFICATION WHEN IT IS REJECTED,
    // or we won't be able to cooldown the verification

    const now = this.dateTimeProvider.now();
    const expirationDate = this.dateTimeProvider
      .of(verification.createdAt)
      .add(settings.codeExpiration, "seconds");

    if (now > expirationDate) {
      this.log.warn("Verification code expired", {
        id: verification.id,
        type: entry.type,
        target: entry.target,
        createdAt: verification.createdAt,
        expiredAt: expirationDate.toISOString(),
      });
      throw new BadRequestError("Verification code has expired");
    }

    if (verification.attempts >= settings.maxAttempts) {
      this.log.warn("Verification locked due to max attempts", {
        id: verification.id,
        type: entry.type,
        target: entry.target,
        attempts: verification.attempts,
        maxAttempts: settings.maxAttempts,
      });
      throw new BadRequestError(
        "Maximum number of attempts reached - verification is locked",
      );
    }

    if (verification.code !== this.hashCode(code)) {
      const newAttempts = verification.attempts + 1;
      this.log.warn("Invalid verification code", {
        id: verification.id,
        type: entry.type,
        target: entry.target,
        attempts: newAttempts,
        maxAttempts: settings.maxAttempts,
      });
      await this.verificationRepository.updateById(verification.id, {
        attempts: newAttempts,
      });
      throw new BadRequestError("Invalid verification code");
    }

    await this.verificationRepository.updateById(verification.id, {
      verifiedAt: this.dateTimeProvider.nowISOString(),
    });

    this.log.info("Verification code verified", {
      id: verification.id,
      type: entry.type,
      target: entry.target,
    });

    return { ok: true };
  }

  public hashCode(code: string): string {
    return createHash("sha256").update(code).digest("hex");
  }

  public generateToken(type: VerificationTypeEnum): string {
    if (type === "code") {
      const settings = this.verificationParameters.get("code");
      return randomInt(0, 1_000_000)
        .toString()
        .padStart(settings.codeLength, "0");
    } else if (type === "link") {
      return this.crypto.randomUUID();
    }

    throw new BadRequestError(`Invalid verification type: ${type}`);
  }
}

export interface VerificationEntry {
  type: VerificationTypeEnum;
  target: string;

  /**
   * Logical purpose bucket. Cooldown and daily-limit checks are scoped to
   * `(type, target, purpose)`, so flows that share a `(type, target)` pair
   * — e.g. email verification and password reset, both `type: "code"` on the
   * same email — get independent rate-limit windows instead of colliding.
   *
   * Defaults to `"default"` when omitted (back-compatible with callers and
   * rows that predate this field).
   */
  purpose?: string;
}
