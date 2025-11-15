import { createHash, randomInt, randomUUID } from "node:crypto";
import { $inject } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { $repository } from "@alepha/orm";
import { BadRequestError, NotFoundError } from "@alepha/server";
import {
  type VerificationEntity,
  verifications,
} from "../entities/verifications.ts";
import { VerificationParameters } from "../parameters/VerificationParameters.ts";
import type { RequestVerificationResponse } from "../schemas/requestVerificationCodeResponseSchema.ts";
import type { ValidateVerificationCodeResponse } from "../schemas/validateVerificationCodeResponseSchema.ts";
import type { VerificationTypeEnum } from "../schemas/verificationTypeEnumSchema.ts";

export class VerificationService {
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly verificationParameters = $inject(VerificationParameters);
  protected readonly verificationRepository = $repository(verifications);

  public async findByEntry(
    entry: VerificationEntry,
  ): Promise<VerificationEntity> {
    const results = await this.verificationRepository.find({
      limit: 1, // only need the most recent entry
      orderBy: {
        column: "createdAt",
        direction: "desc",
      },
      where: {
        type: { eq: entry.type },
        target: { eq: entry.target },
      },
    });

    if (results.length === 0) {
      throw new NotFoundError("Verification entry not found");
    }

    return results[0];
  }

  public findRecentsByEntry(entry: VerificationEntry) {
    return this.verificationRepository.find({
      orderBy: {
        column: "createdAt",
        direction: "desc",
      },
      where: {
        type: { eq: entry.type },
        target: { eq: entry.target },
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
    const settings = this.verificationParameters.get(entry.type);

    const recents = await this.findRecentsByEntry(entry);
    if (recents.length >= settings.limitPerDay) {
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
        throw new BadRequestError(
          `Verification is on cooldown for ${Math.floor(settings.verificationCooldown - diffSec)} seconds`,
        );
      }
    }

    const token = this.generateToken(entry.type);

    await this.verificationRepository.create({
      type: entry.type,
      target: entry.target,
      code: this.hashCode(token),
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
    const settings = this.verificationParameters.get(entry.type);

    const verification = await this.findByEntry(entry);
    if (verification.verifiedAt) {
      return { ok: true, alreadyVerified: true };
    }

    // DO NOT DELETE THE VERIFICATION WHEN IT IS REJECTED,
    // or we won't be able to cooldown the verification

    const now = this.dateTimeProvider.now();
    const expirationDate = this.dateTimeProvider
      .of(verification.createdAt)
      .add(settings.codeExpiration, "seconds");

    if (now > expirationDate) {
      throw new BadRequestError("Verification code has expired");
    }

    if (verification.attempts >= settings.maxAttempts) {
      throw new BadRequestError(
        "Maximum number of attempts reached - verification is locked",
      );
    }

    if (verification.code !== this.hashCode(code)) {
      await this.verificationRepository.updateById(verification.id, {
        attempts: verification.attempts + 1,
      });
      throw new BadRequestError("Invalid verification code");
    }

    await this.verificationRepository.updateById(verification.id, {
      verifiedAt: this.dateTimeProvider.nowISOString(),
    });

    return { ok: true };
  }

  /**
   * Verify a code silently - returns false instead of throwing errors.
   * Useful for password reset where we don't want to reveal if email exists.
   */
  public async verifyCodeSilent(
    entry: VerificationEntry,
    code: string,
  ): Promise<boolean> {
    try {
      const result = await this.verifyCode(entry, code);
      return result.ok;
    } catch {
      return false;
    }
  }

  public hashCode(code: string): string {
    return createHash("sha256").update(code).digest("hex");
  }

  public generateToken(type: VerificationTypeEnum): string {
    if (type === "phone") {
      const settings = this.verificationParameters.get("phone");
      return randomInt(0, 1_000_000)
        .toString()
        .padStart(settings.codeLength, "0");
    } else if (type === "email") {
      return randomUUID();
    }

    throw new BadRequestError(`Invalid verification type: ${type}`);
  }
}

export interface VerificationEntry {
  type: VerificationTypeEnum;
  target: string;
}
