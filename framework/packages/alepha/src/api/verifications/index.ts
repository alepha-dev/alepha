import { $module } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";

import { VerificationController } from "./controllers/VerificationController.ts";
import { VerificationJobs } from "./jobs/VerificationJobs.ts";
import { VerificationParameters } from "./parameters/VerificationParameters.ts";
import { VerificationService } from "./services/VerificationService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./controllers/VerificationController.ts";
export * from "./entities/verifications.ts";
export * from "./errors/VerificationThrottledError.ts";
export * from "./jobs/VerificationJobs.ts";
export * from "./parameters/VerificationParameters.ts";
export * from "./schemas/requestVerificationCodeResponseSchema.ts";
export * from "./schemas/validateVerificationCodeResponseSchema.ts";
export * from "./schemas/verificationTypeEnumSchema.ts";
export * from "./services/VerificationService.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * One-time codes and links that prove a mailbox or a phone number.
 *
 * `VerificationService` creates an entry and hands the token back to the
 * caller, which delivers it (an email, an SMS) and later checks what the
 * recipient submits. The module sends nothing: the module that owns the flow
 * (registration, password reset, an invitation) sends the message.
 *
 * **Features:**
 * - Six digit codes and link tokens, stored hashed
 * - A cooldown and a daily limit per type, target and purpose
 * - An attempt budget per entry, taken atomically
 * - One public route, `POST /verifications/:type/validate`, which answers
 *   every refusal alike and throttles them per caller address and target
 *   (`VerificationThrottledError`, 429)
 * - An hourly purge of entries past their expiry
 *
 * @module alepha.api.verifications
 */
export const AlephaApiVerification = $module({
  name: "alepha.api.verifications",
  imports: [AlephaApiJobs],
  services: [
    VerificationController,
    VerificationJobs,
    VerificationService,
    VerificationParameters,
  ],
});
