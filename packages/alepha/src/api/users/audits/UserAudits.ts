import { $inject } from "alepha";
import { AuditService, type CreateAudit } from "alepha/api/audits";

type AuditContext = Omit<CreateAudit, "type" | "action">;

/**
 * User-specific audit wrapper service.
 *
 * This service wraps the core AuditService to provide user-related audit logging.
 * It is lazy-loaded when the `audits` feature is enabled in the realm.
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
      | "disable",
    context: AuditContext,
  ) {
    return this.auditService.recordUser(action, context);
  }

  /**
   * Record an authentication-related audit event.
   */
  public recordAuth(
    action: "login" | "logout" | "login_failed" | "token_refresh",
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
