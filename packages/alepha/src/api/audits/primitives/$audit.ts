import { $inject, AlephaError, createPrimitive, KIND, Primitive } from "alepha";

import {
  AuditService,
  type AuditTypeDefinition,
} from "../services/AuditService.ts";

/**
 * Options for creating an audit type primitive.
 */
export interface AuditPrimitiveOptions {
  /**
   * Unique audit type identifier (e.g., "auth", "payment", "order").
   */
  type: string;

  /**
   * Human-readable description of this audit type.
   */
  description?: string;

  /**
   * List of allowed actions for this audit type.
   */
  actions: string[];

  /**
   * Number of days entries of this audit type are retained before the periodic
   * cleanup job deletes them.
   *
   * Overrides the global default retention (see `auditOptions.retentionDays` in
   * `AuditParameters`). Set to `0` to keep this type's entries forever,
   * regardless of the global default. When omitted, the global default applies.
   *
   * @example
   * ```ts
   * // Keep security audits for two years, ignoring the global default.
   * $audit({ type: "security", actions: ["login"], retentionDays: 730 });
   * ```
   */
  retentionDays?: number;
}

/**
 * Audit type primitive for registering domain-specific audit events.
 *
 * Provides a type-safe way to define and log audit events within a specific domain.
 *
 * @example
 * ```ts
 * class PaymentAudits {
 *   audit = $audit({
 *     type: "payment",
 *     description: "Payment-related audit events",
 *     actions: ["create", "refund", "cancel", "dispute"],
 *   });
 *
 *   async logPaymentCreated(paymentId: string, userId: string, amount: number) {
 *     await this.audit.log("create", {
 *       userId,
 *       resourceType: "payment",
 *       resourceId: paymentId,
 *       description: `Payment of ${amount} created`,
 *       metadata: { amount },
 *     });
 *   }
 * }
 * ```
 */
export class AuditPrimitive extends Primitive<AuditPrimitiveOptions> {
  protected readonly auditService = $inject(AuditService);

  /**
   * The audit type identifier.
   */
  public get type(): string {
    return this.options.type;
  }

  /**
   * The audit type description.
   */
  public get description(): string | undefined {
    return this.options.description;
  }

  /**
   * The allowed actions for this audit type.
   */
  public get actions(): string[] {
    return this.options.actions;
  }

  /**
   * The dedicated retention (in days) for this audit type, if set.
   */
  public get retentionDays(): number | undefined {
    return this.options.retentionDays;
  }

  /**
   * Log an audit event for this type.
   *
   * `action` must be one of the type's declared {@link actions}: the admin
   * filter options are built from that same list, so an undeclared action
   * (a typo, most often) would be recorded but never surfaceable.
   */
  public async log(
    action: string,
    options: AuditLogOptions = {},
  ): Promise<void> {
    if (!this.options.actions.includes(action)) {
      throw new AlephaError(
        `Unknown audit action '${action}' for type '${this.options.type}'. Declared actions: ${this.options.actions.join(", ")}.`,
      );
    }
    await this.auditService.record(this.options.type, action, options);
  }

  /**
   * Log a successful audit event.
   */
  public async logSuccess(
    action: string,
    options: Omit<AuditLogOptions, "success"> = {},
  ): Promise<void> {
    await this.log(action, { ...options, success: true });
  }

  /**
   * Log a failed audit event.
   */
  public async logFailure(
    action: string,
    errorMessage: string,
    options: Omit<AuditLogOptions, "success" | "errorMessage"> = {},
  ): Promise<void> {
    await this.log(action, { ...options, success: false, errorMessage });
  }

  /**
   * Called during initialization to register this audit type.
   */
  protected onInit(): void {
    const definition: AuditTypeDefinition = {
      type: this.options.type,
      description: this.options.description,
      actions: this.options.actions,
      retentionDays: this.options.retentionDays,
    };
    this.auditService.registerType(definition);
  }
}

/**
 * Options for logging an audit event.
 */
export interface AuditLogOptions {
  severity?: "info" | "warning" | "critical";
  userId?: string;
  userRealm?: string;
  userEmail?: string;
  resourceType?: string;
  resourceId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  requestId?: string;
  success?: boolean;
  errorMessage?: string;
}

/**
 * Create an audit type primitive.
 *
 * @example
 * ```ts
 * class OrderAudits {
 *   audit = $audit({
 *     type: "order",
 *     description: "Order management events",
 *     actions: ["create", "update", "cancel", "fulfill", "ship"],
 *   });
 * }
 * ```
 */
export const $audit = (options: AuditPrimitiveOptions) => {
  return createPrimitive(AuditPrimitive, options);
};

$audit[KIND] = AuditPrimitive;
