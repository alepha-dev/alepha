import type { Infer } from "alepha";
import { z } from "alepha";

/**
 * Audit severity levels for categorizing events.
 */
export const auditSeveritySchema = z
  .enum(["info", "warning", "critical"])
  .describe("Severity level of the audit event")
  .default("info");

export type AuditSeverity = Infer<typeof auditSeveritySchema>;
