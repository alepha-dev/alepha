import { $inject, t } from "alepha";
import { $action } from "alepha/server";
import { auditQuerySchema } from "../schemas/auditQuerySchema.ts";
import { auditResourceSchema } from "../schemas/auditResourceSchema.ts";
import { createAuditSchema } from "../schemas/createAuditSchema.ts";
import { AuditService } from "../services/AuditService.ts";

/**
 * REST API controller for audit log management.
 *
 * Provides endpoints for:
 * - Querying audit logs with filtering
 * - Creating audit entries
 * - Getting audit statistics
 * - Viewing registered audit types
 */
export class AdminAuditController {
  protected readonly url = "/audits";
  protected readonly group = "admin:audits";
  protected readonly auditService = $inject(AuditService);

  /**
   * Find audit entries with filtering and pagination.
   */
  public readonly findAudits = $action({
    path: this.url,
    group: this.group,
    secure: true,
    description: "Find audit entries with filtering and pagination",
    schema: {
      query: auditQuerySchema,
      response: t.page(auditResourceSchema),
    },
    handler: ({ query }) => this.auditService.find(query),
  });

  /**
   * Get a single audit entry by ID.
   */
  public readonly getAudit = $action({
    path: `${this.url}/:id`,
    group: this.group,
    secure: true,
    description: "Get a single audit entry by ID",
    schema: {
      params: t.object({
        id: t.text(),
      }),
      response: auditResourceSchema,
    },
    handler: ({ params }) => this.auditService.getById(params.id),
  });

  /**
   * Create a new audit entry.
   */
  public readonly createAudit = $action({
    method: "POST",
    path: this.url,
    group: this.group,
    secure: true,
    description: "Create a new audit entry",
    schema: {
      body: createAuditSchema,
      response: auditResourceSchema,
    },
    handler: ({ body }) => this.auditService.create(body),
  });

  /**
   * Get audit entries for a specific user.
   */
  public readonly findByUser = $action({
    path: `${this.url}/user/:userId`,
    group: this.group,
    secure: true,
    description: "Get audit entries for a specific user",
    schema: {
      params: t.object({
        userId: t.uuid(),
      }),
      query: t.omit(auditQuerySchema, ["userId"]),
      response: t.page(auditResourceSchema),
    },
    handler: ({ params, query }) =>
      this.auditService.findByUser(params.userId, query),
  });

  /**
   * Get audit entries for a specific resource.
   */
  public readonly findByResource = $action({
    path: `${this.url}/resource/:resourceType/:resourceId`,
    group: this.group,
    secure: true,
    description: "Get audit entries for a specific resource",
    schema: {
      params: t.object({
        resourceType: t.text(),
        resourceId: t.text(),
      }),
      query: t.omit(auditQuerySchema, ["resourceType", "resourceId"]),
      response: t.page(auditResourceSchema),
    },
    handler: ({ params, query }) =>
      this.auditService.findByResource(
        params.resourceType,
        params.resourceId,
        query,
      ),
  });

  /**
   * Get audit statistics.
   */
  public readonly getStats = $action({
    path: `${this.url}/stats`,
    group: this.group,
    secure: true,
    description: "Get audit statistics for a time period",
    schema: {
      query: t.object({
        from: t.optional(t.datetime()),
        to: t.optional(t.datetime()),
        userRealm: t.optional(t.text()),
      }),
      response: t.object({
        total: t.integer(),
        byType: t.record(t.text(), t.integer()),
        bySeverity: t.object({
          info: t.integer(),
          warning: t.integer(),
          critical: t.integer(),
        }),
        successRate: t.number(),
        recentFailures: t.array(auditResourceSchema),
      }),
    },
    handler: ({ query }) =>
      this.auditService.getStats({
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        userRealm: query.userRealm,
      }),
  });

  /**
   * Get registered audit types.
   */
  public readonly getTypes = $action({
    path: `${this.url}/types`,
    group: this.group,
    secure: true,
    description: "Get all registered audit types",
    schema: {
      response: t.array(
        t.object({
          type: t.text(),
          description: t.optional(t.text()),
          actions: t.array(t.text()),
        }),
      ),
    },
    handler: () => this.auditService.getRegisteredTypes(),
  });

  /**
   * Get distinct values for filters.
   */
  public readonly getFilterOptions = $action({
    path: `${this.url}/filters`,
    group: this.group,
    secure: true,
    description: "Get distinct values for audit filters",
    schema: {
      response: t.object({
        types: t.array(t.text()),
        actions: t.array(t.text()),
        resourceTypes: t.array(t.text()),
        userRealms: t.array(t.text()),
      }),
    },
    handler: async () => {
      const types = this.auditService.getRegisteredTypes();
      return {
        types: types.map((t) => t.type),
        actions: types.flatMap((t) => t.actions),
        resourceTypes: ["user", "session", "file", "order", "payment"],
        userRealms: ["default"],
      };
    },
  });
}
