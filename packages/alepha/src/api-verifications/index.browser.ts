import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./entities/verifications.ts";
export * from "./schemas/requestVerificationCodeResponseSchema.ts";
export * from "./schemas/validateVerificationCodeResponseSchema.ts";
export * from "./schemas/verificationTypeEnumSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaApiVerification = $module({
  name: "alepha.api.verifications",
  services: [],
});
