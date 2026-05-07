import { $inject, AlephaError, t } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";
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
      response: t.array(parameterTreeNodeSchema),
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
      query: t.object({
        limit: t.optional(t.integer({ minimum: 1, maximum: 100 })),
        offset: t.optional(t.integer({ minimum: 0 })),
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
    handler: async ({ params, body }) => {
      return this.provider.save(params.name, body.content, body.schemaHash, {
        activationDate: body.activationDate
          ? new Date(body.activationDate)
          : undefined,
        changeDescription: body.changeDescription,
        tags: body.tags,
        creatorId: body.creatorId,
        creatorName: body.creatorName,
      });
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
    handler: async ({ params, body }) => {
      return this.provider.rollback(params.name, body.targetVersion, {
        changeDescription: body.changeDescription,
        creatorId: body.creatorId,
        creatorName: body.creatorName,
      });
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
    handler: async ({ params, body }) => {
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
      return this.provider.save(
        params.name,
        target.content,
        target.schemaHash,
        {
          changeDescription: `Early activation of version ${body.version}`,
          creatorId: body.creatorId,
          creatorName: body.creatorName,
        },
      );
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
      body: t.object({
        names: t.array(t.string({ minLength: 1 }), {
          minItems: 1,
          maxItems: 1000,
        }),
      }),
      response: t.object({
        deleted: t.array(t.string()),
      }),
    },
    handler: async ({ body }) => {
      const deleted = await this.provider.deleteMany(body.names);
      return { deleted };
    },
  });
}
