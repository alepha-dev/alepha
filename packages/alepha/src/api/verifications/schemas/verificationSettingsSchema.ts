import type { Static } from "alepha";
import { z } from "alepha";

export const verificationSettingsSchema = z.object({
  code: z
    .object({
      maxAttempts: z
        .integer()
        .min(1)
        .max(10)
        .describe(
          "Maximum number of attempts before locking the verification.",
        ),
      codeLength: z
        .integer()
        .min(4)
        .max(12)
        .describe("Length of the verification code."),
      codeExpiration: z
        .integer()
        .min(60)
        .max(3600)
        .describe("Time in seconds before the verification code expires."),
      verificationCooldown: z
        .integer()
        .min(0)
        .max(3600)
        .describe("Cooldown period in seconds after a request verification."),
      limitPerDay: z
        .integer()
        .min(1)
        .max(100)
        .describe(
          "Maximum number of verification requests per day for one entry.",
        ),
    })
    .describe("Settings specific to code verifications."),
  link: z
    .object({
      maxAttempts: z
        .integer()
        .min(1)
        .max(10)
        .describe(
          "Maximum number of attempts before locking the verification.",
        ),
      codeExpiration: z
        .integer()
        .min(60)
        .max(7200)
        .describe("Time in seconds before the verification token expires."),
      verificationCooldown: z
        .integer()
        .min(0)
        .max(3600)
        .describe("Cooldown period in seconds after a request verification."),
      limitPerDay: z
        .integer()
        .min(1)
        .max(100)
        .describe(
          "Maximum number of verification requests per day for one entry.",
        ),
    })
    .describe("Settings specific to link verifications."),
  purgeDays: z
    .integer()
    .min(0)
    .max(365)
    .describe(
      "Number of days after which expired verifications are automatically deleted. Set to 0 to disable auto-deletion.",
    ),
});

export type VerificationSettings = Static<typeof verificationSettingsSchema>;
