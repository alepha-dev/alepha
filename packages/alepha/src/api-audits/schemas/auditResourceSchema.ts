import type { Static } from "alepha";
import { audits } from "../entities/audits.ts";

/**
 * Resource schema for audit log responses.
 */
export const auditResourceSchema = audits.schema;

export type AuditResource = Static<typeof auditResourceSchema>;
