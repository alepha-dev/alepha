import type { Static } from "alepha";
import { z } from "alepha";

export const verificationTypeEnumSchema = z.enum(["code", "link"]);
export type VerificationTypeEnum = Static<typeof verificationTypeEnumSchema>;
