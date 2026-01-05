// Browser exports for api-audits module
// Only exports types and schemas that are safe for browser usage

export type { AdminAuditController } from "./controllers/AdminAuditController.ts";
export * from "./entities/audits.ts";
export type {
  AuditLogOptions,
  AuditPrimitive,
  AuditPrimitiveOptions,
} from "./primitives/$audit.ts";
export * from "./schemas/auditQuerySchema.ts";
export * from "./schemas/auditResourceSchema.ts";
export * from "./schemas/createAuditSchema.ts";
export type {
  AuditService,
  AuditStats,
  AuditTypeDefinition,
} from "./services/AuditService.ts";
