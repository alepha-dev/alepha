import type { Infer } from "alepha";

import { audits } from "../entities/audits.ts";

/**
 * Resource schema for audit log responses.
 */
export const auditResourceSchema = audits.schema;

export type AuditResource = Infer<typeof auditResourceSchema>;
