import type { Static } from "@alepha/core";
import { t } from "@alepha/core";

export const verificationTypeEnumSchema = t.enum(["phone", "email"]);
export type VerificationTypeEnum = Static<typeof verificationTypeEnumSchema>;
