import type { Static } from "alepha";
import { t } from "alepha";

export const verificationTypeEnumSchema = t.enum(["phone", "email"]);
export type VerificationTypeEnum = Static<typeof verificationTypeEnumSchema>;
