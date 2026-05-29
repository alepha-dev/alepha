import { $inject } from "alepha";
import { AuditService, type CreateAudit } from "alepha/api/audits";

type AuditContext = Omit<CreateAudit, "type" | "action">;

/**
 * User-specific audit wrapper service.
 *
 * This service wraps the core AuditService to provide user-related audit logging.
 *
 * Declared as a module variant — not auto-injected. It is instantiated
 * lazily the first time something calls `alepha.inject(UserAudits)`.
 */
export class UserAudits {
  protected readonly auditService = $inject(AuditService);

  /**
   * Record a user-related audit event.
   */
  public recordUser(
    action:
      | "create"
      | "update"
      | "delete"
      | "role_change"
      | "enable"
      | "disable"
      | "password_change",
    context: AuditContext,
  ) {
    return this.auditService.recordUser(action, context);
  }

  /**
   * Record an authentication-related audit event.
   */
  public recordAuth(
    action: "login" | "logout" | "token_refresh",
    context: AuditContext,
  ) {
    return this.auditService.recordAuth(action, context);
  }

  /**
   * Record a generic audit event.
   */
  public record(category: string, action: string, context: AuditContext) {
    return this.auditService.record(category, action, context);
  }
}
