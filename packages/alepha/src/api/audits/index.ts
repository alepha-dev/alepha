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
 * Provides audit logging API endpoints for Alepha applications.
 *
 * This module includes:
 * - Audit log CRUD operations
 * - Filtering and searching audit events
 * - Audit statistics and analytics
 * - `$audit` primitive for domain-specific audit types
 *
 * @module alepha.api.audits
 *
 * @example
 * ```ts
 * // In your app module
 * import { AlephaApiAudits } from "alepha/api/audits";
 *
 * const App = $module({
 *   name: "app",
 *   services: [AlephaApiAudits, ...],
 * });
 *
 * // Create domain-specific audit types
 * class PaymentAudits {
 *   audit = $audit({
 *     type: "payment",
 *     actions: ["create", "refund", "cancel"],
 *   });
 *
 *   async onPaymentCreated(paymentId: string, userId: string) {
 *     await this.audit.log("create", {
 *       userId,
 *       resourceType: "payment",
 *       resourceId: paymentId,
 *     });
 *   }
 * }
 * ```
 */
export const AlephaApiAudits = $module({
  name: "alepha.api.audits",
  services: [AuditService, AdminAuditController],
});
