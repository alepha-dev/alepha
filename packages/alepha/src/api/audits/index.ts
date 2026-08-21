import { $module } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";

import { AdminAuditController } from "./controllers/AdminAuditController.ts";
import { AuditJobs } from "./jobs/AuditJobs.ts";
import { AuditParameters } from "./parameters/AuditParameters.ts";
import { AuditService } from "./services/AuditService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./controllers/AdminAuditController.ts";
export * from "./entities/audits.ts";
export * from "./jobs/AuditJobs.ts";
export * from "./parameters/AuditParameters.ts";
export * from "./primitives/$audit.ts";
export * from "./schemas/auditQuerySchema.ts";
export * from "./schemas/auditResourceSchema.ts";
export * from "./schemas/createAuditSchema.ts";
export * from "./services/AuditService.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Audit trail for compliance.
 *
 * **Features:**
 * - Domain-specific audit types
 * - Audit event logging
 * - Filtering and searching
 * - User action tracking
 * - Retention policy with a default + per-type TTL ({@link AuditParameters}, {@link AuditJobs})
 *
 * @module alepha.api.audits
 */
export const AlephaApiAudits = $module({
  name: "alepha.api.audits",
  imports: [AlephaApiJobs],
  services: [AuditService, AdminAuditController, AuditParameters, AuditJobs],
});
