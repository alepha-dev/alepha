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

  /**
   * Merge a burst of identical events into one row carrying a count, instead
   * of writing one row per event.
   *
   * A project's activity feed prints one row per recorded write, so a session
   * editing one resource ten times in twenty minutes produces ten
   * near-identical rows. They are genuine events, not duplicates, but a reader
   * scrolling the feed learns nothing from the ninth. This folds them, and
   * shrinks the table that grows without bound while it is at it.
   *
   * ⚠️ **Per ACTION, not per type.** A type declares a dozen verbs and only
   * the churny ones should merge: `update` yes, `create` and `delete` no,
   * because each of those is a distinct fact that happens once. The listed
   * actions are validated as a subset of {@link AuditPrimitiveOptions.actions}
   * at registration, the same way `log()` validates its argument, so a typo
   * fails at boot rather than silently never merging.
   *
   * @example
   * ```ts
   * $audit({
   *   type: "folio",
   *   actions: ["create", "update", "delete"],
   *   coalesce: { actions: ["update"], window: "5m" },
   * });
   * ```
   */
  coalesce?: AuditCoalesceOptions;
}

/**
 * Which of a type's actions merge, and how close together they have to be.
 */
export interface AuditCoalesceOptions {
  /**
   * The actions that merge. Must be a subset of the type's declared actions.
   */
  actions: string[];

  /**
   * How long a row stays open to further events, as `<n>s`, `<n>m` or `<n>h`.
   *
   * ⚠️ Measured from the row's `createdAt`, never from its last event, and
   * that is the load-bearing decision. A coalesced row can then never span
   * more than this window, so its position in a feed sorted by `createdAt`
   * is off by at most that much. Measuring from the last event would let a
   * resource edited every four minutes for an hour claim a one-hour span
   * while sitting at that hour's start.
   *
   * It also keeps the lookup a plain range on `createdAt`, which the existing
   * composite indexes serve as a seek over a handful of rows.
   *
   * The cost is that a long burst becomes several rows rather than one, which
   * is wanted: one row saying "x40 over an afternoon" hides a resource being
   * picked up and put down repeatedly.
   */
  window: string;
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
   * Which actions merge, and how close together, if any.
   */
  public get coalesce(): AuditCoalesceOptions | undefined {
    return this.options.coalesce;
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
      coalesce: this.options.coalesce,
    };
    // Both the action subset and the window spec are checked in
    // `registerType`, which is the one place every type passes through - so
    // a malformed declaration fails at boot rather than at the first write.
    this.auditService.registerType(definition);
  }
}

/**
 * Options for logging an audit event.
 */
export interface AuditLogOptions {
  severity?: "info" | "warning" | "critical";

  /**
   * The container this event happened inside, and its identifier.
   *
   * Omit both for an app-layer event (a sign-in, a tenant being created):
   * those belong to the deployment rather than to any one tenant, and the
   * admin audit page is where they are read.
   *
   * Set both for a tenant-layer event, and set them together: the indexes
   * lead on the pair, so a `scopeId` without a `scopeType` is a row no
   * scoped query will ever return.
   */
  scopeType?: string;
  scopeId?: string;

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
