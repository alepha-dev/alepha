import { $inject, Alepha, AlephaError, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";
import { ParameterAudits } from "../audits/ParameterAudits.ts";
import { activateParameterBodySchema } from "../schemas/activateParameterBodySchema.ts";
import { createParameterVersionBodySchema } from "../schemas/createParameterVersionBodySchema.ts";
import { parameterCurrentResponseSchema } from "../schemas/parameterCurrentResponseSchema.ts";
import { parameterHistoryResponseSchema } from "../schemas/parameterHistoryResponseSchema.ts";
import { parameterNameParamSchema } from "../schemas/parameterNameParamSchema.ts";
import { parameterNamesResponseSchema } from "../schemas/parameterNamesResponseSchema.ts";
import { parameterResponseSchema } from "../schemas/parameterResponseSchema.ts";
import { parameterTreeNodeSchema } from "../schemas/parameterTreeNodeSchema.ts";
import { parameterVersionParamSchema } from "../schemas/parameterVersionParamSchema.ts";
import { parameterVersionResponseSchema } from "../schemas/parameterVersionResponseSchema.ts";
import { rollbackParameterBodySchema } from "../schemas/rollbackParameterBodySchema.ts";
import { ParameterProvider } from "../services/ParameterProvider.ts";

/**
 * REST API controller for versioned parameter management.
 *
 * Provides endpoints for:
 * - Listing all parameters (tree view support)
 * - Getting parameter history (all versions with calculated status)
 * - Getting current/next parameter values
 * - Creating new parameter versions (immediate or scheduled)
 * - Rolling back to previous versions
 * - Activating scheduled versions immediately
 */
export class AdminParameterController {
  protected readonly url = "/parameters";
  protected readonly group = "admin:parameters";
  protected readonly provider = $inject(ParameterProvider);
  protected readonly alepha = $inject(Alepha);

  /**
   * Get tree structure of all parameter names.
   * Useful for admin UI navigation.
   */
  getParameterTree = $action({
    group: this.group,
    use: [$secure({ permissions: ["admin:parameter:read"] })],
    description: "Get tree structure of all parameter names for navigation.",
    path: "/parameters/tree",
    method: "GET",
    schema: {
      response: z.array(parameterTreeNodeSchema),
    },
    handler: async () => {
      return this.provider.getParameterTree();
    },
  });

  /**
   * List all unique parameter names.
   */
  listParameterNames = $action({
    group: this.group,
    use: [$secure({ permissions: ["admin:parameter:read"] })],
    description: "List all unique parameter names.",
    path: "/parameters",
    method: "GET",
    schema: {
      response: parameterNamesResponseSchema,
    },
    handler: async () => {
      const names = await this.provider.getParameterNames();
      return { names };
    },
  });

  /**
   * Get version history for a specific parameter.
   * Returns all versions with calculated status.
   */
  getHistory = $action({
    group: this.group,
    use: [$secure({ permissions: ["admin:parameter:read"] })],
    description: "Get all versions of a specific parameter.",
    path: "/parameters/:name/history",
    method: "GET",
    schema: {
      params: parameterNameParamSchema,
      query: z.object({
        limit: z.integer().min(1).max(100).optional(),
        offset: z.integer().min(0).optional(),
      }),
      response: parameterHistoryResponseSchema,
    },
    handler: async ({ params, query }) => {
      const rawVersions = await this.provider.getHistory(params.name, {
        limit: query.limit,
        offset: query.offset,
      });
      const versions = this.provider.calculateStatuses(rawVersions);
      return { versions };
    },
  });

  /**
   * Get current and next values for a parameter.
   * Includes defaultValue and currentValue from the registered primitive
   * even if no versions exist in the database yet.
   */
  getCurrent = $action({
    group: this.group,
    use: [$secure({ permissions: ["admin:parameter:read"] })],
    description: "Get current and next scheduled values for a parameter.",
    path: "/parameters/:name",
    method: "GET",
    schema: {
      params: parameterNameParamSchema,
      response: parameterCurrentResponseSchema,
    },
    handler: async ({ params }) => {
      const result = await this.provider.getCurrentWithDefault(params.name);
      return {
        current: result.current ?? undefined,
        next: result.next ?? undefined,
        defaultValue: result.defaultValue ?? undefined,
        currentValue: result.currentValue ?? undefined,
        schema: result.schema ?? undefined,
        description: result.description ?? undefined,
      };
    },
  });

  /**
   * Get a specific version of a parameter.
   */
  getVersion = $action({
    group: this.group,
    use: [$secure({ permissions: ["admin:parameter:read"] })],
    description: "Get a specific version of a parameter.",
    path: "/parameters/:name/versions/:version",
    method: "GET",
    schema: {
      params: parameterVersionParamSchema,
      response: parameterVersionResponseSchema,
    },
    handler: async ({ params }) => {
      const version = await this.provider.getVersion(
        params.name,
        params.version,
      );
      if (!version) {
        return { parameter: undefined };
      }
      const [withStatus] = this.provider.calculateStatuses([version]);
      return { parameter: withStatus };
    },
  });

  /**
   * Create a new parameter version.
   */
  createVersion = $action({
    group: this.group,
    use: [$secure({ permissions: ["admin:parameter:create"] })],
    description:
      "Create a new version of a parameter (immediate or scheduled).",
    path: "/parameters/:name",
    method: "POST",
    schema: {
      params: parameterNameParamSchema,
      body: createParameterVersionBodySchema,
      response: parameterResponseSchema,
    },
    handler: async ({ params, body, user }) => {
      // Empty hash → `save()` resolves the registered one, so admin writes are
      // always validated against the current schema.
      const result = await this.provider.save(params.name, body.content, "", {
        activationDate: body.activationDate
          ? new Date(body.activationDate)
          : undefined,
        changeDescription: body.changeDescription,
        tags: body.tags,
        creatorId: user?.id,
        creatorName: this.creatorNameOf(user),
      });
      await this.audit("create", params.name, {
        version: result.version,
        scheduled: result.status !== "current",
      });
      return result;
    },
  });

  /**
   * Rollback to a previous version.
   */
  rollback = $action({
    group: this.group,
    use: [$secure({ permissions: ["admin:parameter:rollback"] })],
    description:
      "Rollback a parameter to a previous version (creates new version with old content).",
    path: "/parameters/:name/rollback",
    method: "POST",
    schema: {
      params: parameterNameParamSchema,
      body: rollbackParameterBodySchema,
      response: parameterResponseSchema,
    },
    handler: async ({ params, body, user }) => {
      const result = await this.provider.rollback(
        params.name,
        body.targetVersion,
        {
          changeDescription: body.changeDescription,
          creatorId: user?.id,
          creatorName: this.creatorNameOf(user),
        },
      );
      await this.audit("rollback", params.name, {
        version: result.version,
        targetVersion: body.targetVersion,
      });
      return result;
    },
  });

  /**
   * Activate a scheduled version immediately.
   * Creates a new version with the same content but immediate activation.
   */
  activateNow = $action({
    group: this.group,
    use: [$secure({ permissions: ["admin:parameter:activate"] })],
    description: "Activate a future/next parameter version immediately.",
    path: "/parameters/:name/activate",
    method: "POST",
    schema: {
      params: parameterNameParamSchema,
      body: activateParameterBodySchema,
      response: parameterResponseSchema,
    },
    handler: async ({ params, body, user }) => {
      const allVersions = await this.provider.getHistory(params.name);
      const withStatuses = this.provider.calculateStatuses(allVersions);
      const target = withStatuses.find((v) => v.version === body.version);

      if (!target) {
        throw new AlephaError(
          `Version ${body.version} not found for parameter ${params.name}`,
        );
      }

      if (target.status === "current") {
        return target;
      }

      if (target.status === "expired") {
        throw new AlephaError(
          "Cannot activate an expired version. Use rollback instead.",
        );
      }

      // Create new version with same content but immediate activation
      const result = await this.provider.save(
        params.name,
        target.content,
        target.schemaHash,
        {
          changeDescription: `Early activation of version ${body.version}`,
          creatorId: user?.id,
          creatorName: this.creatorNameOf(user),
        },
      );
      await this.audit("activate", params.name, {
        version: result.version,
        activatedFrom: body.version,
      });
      return result;
    },
  });

  /**
   * Delete all versions of a parameter.
   */
  deleteParameter = $action({
    group: this.group,
    use: [$secure({ permissions: ["admin:parameter:delete"] })],
    description: "Delete all versions of a parameter.",
    path: "/parameters/:name",
    method: "DELETE",
    schema: {
      params: parameterNameParamSchema,
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.provider.delete(params.name);
      await this.audit("delete", params.name);
      return { ok: true };
    },
  });

  /**
   * Delete many parameters (all versions of each) in one request.
   */
  deleteParameters = $action({
    group: this.group,
    use: [$secure({ permissions: ["admin:parameter:delete"] })],
    description: "Delete all versions of many parameters by name.",
    path: "/parameters/delete",
    method: "POST",
    schema: {
      body: z.object({
        names: z.array(z.string().min(1)).min(1).max(1000),
      }),
      response: z.object({
        deleted: z.array(z.string()),
      }),
    },
    handler: async ({ body }) => {
      const deleted = await this.provider.deleteMany(body.names);
      for (const name of deleted) {
        await this.audit("delete", name);
      }
      return { deleted };
    },
  });

  /**
   * Derive a human-readable creator name from the authenticated session token.
   *
   * The name is snapshotted onto the version at write time rather than joined
   * from the users table on read: this keeps the parameters module free of any
   * dependency on the users module (no import, no circular-import risk). The
   * trade-off is that the stored name does not follow later user renames.
   *
   * Precedence: `username` → `email`. The token's `name` is intentionally
   * skipped: the security layer fills it with a placeholder ("Anonymous User")
   * when the issuer supplies no name, which would otherwise be snapshotted.
   */
  protected creatorNameOf(user?: {
    username?: string;
    email?: string;
  }): string | undefined {
    return user?.username ?? user?.email;
  }

  /**
   * Record a parameter mutation via the `ParameterAudits` holder — best-effort.
   *
   * `ParameterAudits` is resolved lazily from the container; when it is not
   * registered, auditing is silently skipped. Actor (userId / email / realm),
   * IP, and request id are auto-filled by `AuditService` from the request
   * context. Failures never break the underlying operation.
   */
  protected async audit(
    action: "create" | "rollback" | "activate" | "delete",
    name: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.alepha.has(ParameterAudits)) {
      return;
    }
    try {
      await this.alepha.inject(ParameterAudits).parameter.log(action, {
        resourceType: "parameter",
        resourceId: name,
        metadata,
      });
    } catch {
      // Auditing is best-effort; never fail the operation because of it.
    }
  }
}
