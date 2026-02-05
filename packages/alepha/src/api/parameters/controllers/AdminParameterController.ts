import { $inject, t } from "alepha";
import { $action } from "alepha/server";
import type { ParameterStatus } from "../entities/parameters.ts";
import {
  activateParameterBodySchema,
  checkScheduledResponseSchema,
  createParameterVersionBodySchema,
  parameterCurrentResponseSchema,
  parameterHistoryResponseSchema,
  parameterNameParamSchema,
  parameterNamesResponseSchema,
  parameterResponseSchema,
  parametersByStatusResponseSchema,
  parameterTreeNodeSchema,
  parameterVersionParamSchema,
  parameterVersionResponseSchema,
  rollbackParameterBodySchema,
  statusParamSchema,
} from "../schemas/index.ts";
import { ParameterStore } from "../services/ParameterStore.ts";

/**
 * REST API controller for versioned parameter management.
 *
 * Provides endpoints for:
 * - Listing all parameters (tree view support)
 * - Getting parameter history (all versions)
 * - Getting current/next parameter values
 * - Creating new parameter versions (immediate or scheduled)
 * - Rolling back to previous versions
 * - Activating scheduled versions immediately
 */
export class AdminParameterController {
  protected readonly url = "/parameters";
  protected readonly group = "admin:parameters";
  protected readonly store = $inject(ParameterStore);

  /**
   * Get tree structure of all parameter names.
   * Useful for admin UI navigation.
   */
  getParameterTree = $action({
    group: this.group,
    secure: true,
    description: "Get tree structure of all parameter names for navigation.",
    path: "/parameters/tree",
    method: "GET",
    schema: {
      response: t.array(parameterTreeNodeSchema),
    },
    handler: async () => {
      return this.store.getParameterTree();
    },
  });

  /**
   * List all unique parameter names.
   */
  listParameterNames = $action({
    group: this.group,
    secure: true,
    description: "List all unique parameter names.",
    path: "/parameters",
    method: "GET",
    schema: {
      response: parameterNamesResponseSchema,
    },
    handler: async () => {
      const names = await this.store.getParameterNames();
      return { names };
    },
  });

  /**
   * Get parameters by status.
   */
  getByStatus = $action({
    group: this.group,
    secure: true,
    description: "Get all parameters with a specific status.",
    path: "/parameters/status/:status",
    method: "GET",
    schema: {
      params: statusParamSchema,
      response: parametersByStatusResponseSchema,
    },
    handler: async ({ params }) => {
      const parameters = await this.store.getByStatus(
        params.status as ParameterStatus,
      );
      return { parameters };
    },
  });

  /**
   * Get version history for a specific parameter.
   */
  getHistory = $action({
    group: this.group,
    secure: true,
    description: "Get all versions of a specific parameter.",
    path: "/parameters/:name/history",
    method: "GET",
    schema: {
      params: parameterNameParamSchema,
      response: parameterHistoryResponseSchema,
    },
    handler: async ({ params }) => {
      const versions = await this.store.getHistory(params.name);
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
    secure: true,
    description: "Get current and next scheduled values for a parameter.",
    path: "/parameters/:name",
    method: "GET",
    schema: {
      params: parameterNameParamSchema,
      response: parameterCurrentResponseSchema,
    },
    handler: async ({ params }) => {
      const result = await this.store.getCurrentWithDefault(params.name);
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
    secure: true,
    description: "Get a specific version of a parameter.",
    path: "/parameters/:name/versions/:version",
    method: "GET",
    schema: {
      params: parameterVersionParamSchema,
      response: parameterVersionResponseSchema,
    },
    handler: async ({ params }) => {
      const parameter = await this.store.getVersion(
        params.name,
        params.version,
      );
      return { parameter: parameter ?? undefined };
    },
  });

  /**
   * Create a new parameter version.
   */
  createVersion = $action({
    group: this.group,
    secure: true,
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
      return this.store.save(params.name, body.content, body.schemaHash, {
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
    secure: true,
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
      return this.store.rollback(params.name, body.targetVersion, {
        changeDescription: body.changeDescription,
        creatorId: body.creatorId,
        creatorName: body.creatorName,
      });
    },
  });

  /**
   * Activate a scheduled version immediately.
   */
  activateNow = $action({
    group: this.group,
    secure: true,
    description: "Activate a future/next parameter version immediately.",
    path: "/parameters/:name/activate",
    method: "POST",
    schema: {
      params: parameterNameParamSchema,
      body: activateParameterBodySchema,
      response: parameterResponseSchema,
    },
    handler: async ({ params, body }) => {
      const target = await this.store.getVersion(params.name, body.version);
      if (!target) {
        throw new Error(
          `Version ${body.version} not found for parameter ${params.name}`,
        );
      }

      if (target.status === "current") {
        return target; // Already current
      }

      if (target.status === "expired") {
        throw new Error(
          "Cannot activate an expired version. Use rollback instead.",
        );
      }

      // Create new version with same content but immediate activation
      return this.store.save(params.name, target.content, target.schemaHash, {
        changeDescription: `Early activation of version ${body.version}`,
        creatorId: body.creatorId,
        creatorName: body.creatorName,
      });
    },
  });

  /**
   * Trigger activation check for all scheduled parameters.
   * Normally called by a scheduler, but exposed for manual triggering.
   */
  checkScheduled = $action({
    group: this.group,
    secure: true,
    description:
      "Manually trigger activation check for all scheduled parameters.",
    path: "/parameters/activate-scheduled",
    method: "POST",
    schema: {
      response: checkScheduledResponseSchema,
    },
    handler: async () => {
      await this.store.activateScheduledParameters();
      return { message: "Scheduled parameter activation check completed" };
    },
  });
}
