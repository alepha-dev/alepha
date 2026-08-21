import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { audits } from "../entities/audits.ts";
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
  protected readonly repo = $repository(audits);

  /**
   * Find audit entries with filtering and pagination.
   */
  public readonly findAudits = $action({
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:audit:read"] })],
    description: "Find audit entries with filtering and pagination",
    schema: {
      query: auditQuerySchema,
      response: z.page(auditResourceSchema),
    },
    handler: ({ query }) => this.auditService.find(query),
  });

  /**
   * Get a single audit entry by ID.
   */
  public readonly getAudit = $action({
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:audit:read"] })],
    description: "Get a single audit entry by ID",
    schema: {
      params: z.object({
        id: z.text(),
      }),
      response: auditResourceSchema,
    },
    handler: ({ params }) => this.auditService.getById(params.id),
  });

  /**
   * Delete many audit entries by id in one repository call. Use with care —
   * audit logs are usually retained for compliance reasons.
   */
  public readonly deleteAudits = $action({
    method: "POST",
    path: `${this.url}/delete`,
    group: this.group,
    use: [$secure({ permissions: ["admin:audit:delete"] })],
    description: "Delete many audit entries",
    schema: {
      body: z.object({
        ids: z.array(z.text()).min(1).max(1000),
      }),
      response: z.object({
        deleted: z.array(z.text()),
      }),
    },
    handler: async ({ body }) => {
      const deleted = await this.repo.deleteMany({
        id: { inArray: body.ids },
      });
      return { deleted: deleted.map(String) };
    },
  });

  /**
   * Create a new audit entry.
   * System-only — this permission should never be assigned to human roles.
   */
  public readonly createAudit = $action({
    method: "POST",
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:audit:create"] })],
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
    use: [$secure({ permissions: ["admin:audit:read"] })],
    description: "Get audit entries for a specific user",
    schema: {
      params: z.object({
        userId: z.uuid(),
      }),
      query: auditQuerySchema.omit({ userId: true }),
      response: z.page(auditResourceSchema),
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
    use: [$secure({ permissions: ["admin:audit:read"] })],
    description: "Get audit entries for a specific resource",
    schema: {
      params: z.object({
        resourceType: z.text(),
        resourceId: z.text(),
      }),
      query: auditQuerySchema.omit({ resourceType: true, resourceId: true }),
      response: z.page(auditResourceSchema),
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
  public readonly getAuditStats = $action({
    path: `${this.url}/stats`,
    group: this.group,
    use: [$secure({ permissions: ["admin:audit:read"] })],
    description: "Get audit statistics for a time period",
    schema: {
      query: z.object({
        from: z.datetime().optional(),
        to: z.datetime().optional(),
        userRealm: z.text().optional(),
      }),
      response: z.object({
        total: z.integer(),
        byType: z.record(z.text(), z.integer()),
        bySeverity: z.object({
          info: z.integer(),
          warning: z.integer(),
          critical: z.integer(),
        }),
        successRate: z.number(),
        recentFailures: z.array(auditResourceSchema),
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
   * List distinct action names present in the audit log (for filters).
   */
  public readonly getAuditActions = $action({
    path: `${this.url}/actions`,
    group: this.group,
    use: [$secure({ permissions: ["admin:audit:read"] })],
    description: "List distinct action names present in the audit log",
    schema: {
      response: z.array(z.text()),
    },
    handler: () => this.auditService.getDistinctActions(),
  });

  /**
   * Get registered audit types.
   */
  public readonly getTypes = $action({
    path: `${this.url}/types`,
    group: this.group,
    use: [$secure({ permissions: ["admin:audit:read"] })],
    description: "Get all registered audit types",
    schema: {
      response: z.array(
        z.object({
          type: z.text(),
          description: z.text().optional(),
          actions: z.array(z.text()),
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
    use: [$secure({ permissions: ["admin:audit:read"] })],
    description: "Get distinct values for audit filters",
    schema: {
      response: z.object({
        types: z.array(z.text()),
        actions: z.array(z.text()),
        resourceTypes: z.array(z.text()),
        userRealms: z.array(z.text()),
      }),
    },
    handler: async () => {
      const types = this.auditService.getRegisteredTypes();
      const distinct = await this.auditService.getDistinctFilterValues();
      return {
        types: types.map((t) => t.type),
        actions: types.flatMap((t) => t.actions),
        ...distinct,
      };
    },
  });
}
