import { $inject, t } from "alepha";
import { $action } from "alepha/server";
import type { ParameterStatus } from "../entities/parameters.ts";
import {
  activateConfigBodySchema,
  checkScheduledResponseSchema,
  configCurrentResponseSchema,
  configHistoryResponseSchema,
  configNameParamSchema,
  configNamesResponseSchema,
  configsByStatusResponseSchema,
  configTreeNodeSchema,
  configVersionParamSchema,
  configVersionResponseSchema,
  createConfigVersionBodySchema,
  parameterResponseSchema,
  rollbackConfigBodySchema,
  statusParamSchema,
} from "../schemas/index.ts";
import { ConfigStore } from "../services/ConfigStore.ts";

/**
 * REST API controller for versioned configuration management.
 *
 * Provides endpoints for:
 * - Listing all configurations (tree view support)
 * - Getting configuration history (all versions)
 * - Getting current/next configuration values
 * - Creating new configuration versions (immediate or scheduled)
 * - Rolling back to previous versions
 * - Activating scheduled versions immediately
 */
export class AdminConfigController {
  protected readonly url = "/configs";
  protected readonly group = "admin:configs";
  protected readonly store = $inject(ConfigStore);

  /**
   * Get tree structure of all configuration names.
   * Useful for admin UI navigation.
   */
  getConfigTree = $action({
    group: this.group,
    description:
      "Get tree structure of all configuration names for navigation.",
    path: "/configs/tree",
    method: "GET",
    schema: {
      response: t.array(configTreeNodeSchema),
    },
    handler: async () => {
      return this.store.getConfigTree();
    },
  });

  /**
   * List all unique configuration names.
   */
  listConfigNames = $action({
    group: this.group,
    description: "List all unique configuration names.",
    path: "/configs",
    method: "GET",
    schema: {
      response: configNamesResponseSchema,
    },
    handler: async () => {
      const names = await this.store.getConfigNames();
      return { names };
    },
  });

  /**
   * Get configurations by status.
   */
  getByStatus = $action({
    group: this.group,
    description: "Get all configurations with a specific status.",
    path: "/configs/status/:status",
    method: "GET",
    schema: {
      params: statusParamSchema,
      response: configsByStatusResponseSchema,
    },
    handler: async ({ params }) => {
      const configs = await this.store.getByStatus(
        params.status as ParameterStatus,
      );
      return { configs };
    },
  });

  /**
   * Get version history for a specific configuration.
   */
  getHistory = $action({
    group: this.group,
    description: "Get all versions of a specific configuration.",
    path: "/configs/:name/history",
    method: "GET",
    schema: {
      params: configNameParamSchema,
      response: configHistoryResponseSchema,
    },
    handler: async ({ params }) => {
      const versions = await this.store.getHistory(params.name);
      return { versions };
    },
  });

  /**
   * Get current and next values for a configuration.
   * Includes defaultValue and currentValue from the registered primitive
   * even if no versions exist in the database yet.
   */
  getCurrent = $action({
    group: this.group,
    description: "Get current and next scheduled values for a configuration.",
    path: "/configs/:name",
    method: "GET",
    schema: {
      params: configNameParamSchema,
      response: configCurrentResponseSchema,
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
   * Get a specific version of a configuration.
   */
  getVersion = $action({
    group: this.group,
    description: "Get a specific version of a configuration.",
    path: "/configs/:name/versions/:version",
    method: "GET",
    schema: {
      params: configVersionParamSchema,
      response: configVersionResponseSchema,
    },
    handler: async ({ params }) => {
      const config = await this.store.getVersion(params.name, params.version);
      return { config: config ?? undefined };
    },
  });

  /**
   * Create a new configuration version.
   */
  createVersion = $action({
    group: this.group,
    description:
      "Create a new version of a configuration (immediate or scheduled).",
    path: "/configs/:name",
    method: "POST",
    schema: {
      params: configNameParamSchema,
      body: createConfigVersionBodySchema,
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
    description:
      "Rollback a configuration to a previous version (creates new version with old content).",
    path: "/configs/:name/rollback",
    method: "POST",
    schema: {
      params: configNameParamSchema,
      body: rollbackConfigBodySchema,
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
    description: "Activate a future/next configuration version immediately.",
    path: "/configs/:name/activate",
    method: "POST",
    schema: {
      params: configNameParamSchema,
      body: activateConfigBodySchema,
      response: parameterResponseSchema,
    },
    handler: async ({ params, body }) => {
      const target = await this.store.getVersion(params.name, body.version);
      if (!target) {
        throw new Error(
          `Version ${body.version} not found for config ${params.name}`,
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
   * Trigger activation check for all scheduled configs.
   * Normally called by a scheduler, but exposed for manual triggering.
   */
  checkScheduled = $action({
    group: this.group,
    description:
      "Manually trigger activation check for all scheduled configurations.",
    path: "/configs/activate-scheduled",
    method: "POST",
    schema: {
      response: checkScheduledResponseSchema,
    },
    handler: async () => {
      await this.store.activateScheduledConfigs();
      return { message: "Scheduled configuration activation check completed" };
    },
  });
}
