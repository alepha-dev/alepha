import { $module } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { VerificationController } from "./controllers/VerificationController.ts";
import { VerificationJobs } from "./jobs/VerificationJobs.ts";
import { VerificationParameters } from "./parameters/VerificationParameters.ts";
import { VerificationService } from "./services/VerificationService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./controllers/VerificationController.ts";
export * from "./entities/verifications.ts";
export * from "./jobs/VerificationJobs.ts";
export * from "./parameters/VerificationParameters.ts";
export * from "./schemas/requestVerificationCodeResponseSchema.ts";
export * from "./schemas/validateVerificationCodeResponseSchema.ts";
export * from "./schemas/verificationTypeEnumSchema.ts";
export * from "./services/VerificationService.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Email and phone verification workflows.
 *
 * **Features:**
 * - Verification token generation
 * - Verification code sending
 * - Verification completion tracking
 * - Resend functionality
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
