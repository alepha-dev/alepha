import type { Static } from "alepha";
import { t } from "alepha";

export const verificationTypeEnumSchema = t.enum(["code", "link"]);
export type VerificationTypeEnum = Static<typeof verificationTypeEnumSchema>;
