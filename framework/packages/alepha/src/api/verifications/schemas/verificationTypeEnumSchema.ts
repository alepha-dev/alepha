import type { Infer } from "alepha";
import { z } from "alepha";

export const verificationTypeEnumSchema = z.enum(["code", "link"]);
export type VerificationTypeEnum = Infer<typeof verificationTypeEnumSchema>;
