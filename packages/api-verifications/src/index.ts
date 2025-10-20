import { $module } from "@alepha/core";
import { VerificationController } from "./controllers/VerificationController.ts";
import { VerificationJobs } from "./jobs/VerificationJobs.ts";
import { VerificationService } from "./services/VerificationService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./controllers/VerificationController.ts";
export * from "./schemas/requestVerificationCodeResponseSchema.ts";
export * from "./schemas/validateVerificationCodeResponseSchema.ts";
export * from "./schemas/verificationTypeEnumSchema.ts";
export * from "./services/VerificationService.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides email/phone verification management API endpoints for Alepha applications.
 *
 * This module includes verification code generation, validation,
 * and related functionalities. Notifications are handled by the consuming module
 * (e.g., api-users) for context-specific messaging.
 *
 * @module alepha.api.verifications
 */
export const AlephaApiVerification = $module({
  name: "alepha.api.verifications",
  services: [VerificationController, VerificationJobs, VerificationService],
});
