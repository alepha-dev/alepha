import { $module } from "alepha";
import { AdminAuditController } from "./controllers/AdminAuditController.ts";
import { AuditService } from "./services/AuditService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./controllers/AdminAuditController.ts";
export * from "./entities/audits.ts";
export * from "./primitives/$audit.ts";
export * from "./schemas/auditQuerySchema.ts";
export * from "./schemas/auditResourceSchema.ts";
export * from "./schemas/createAuditSchema.ts";
export * from "./services/AuditService.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | backend | standard | stable |
 *
 * Audit trail for compliance.
 *
 * **Features:**
 * - Domain-specific audit types
 * - Audit event logging
 * - Filtering and searching
 * - User action tracking
 *
 * @module alepha.api.audits
 */
export const AlephaApiAudits = $module({
  name: "alepha.api.audits",
  services: [AuditService, AdminAuditController],
});
