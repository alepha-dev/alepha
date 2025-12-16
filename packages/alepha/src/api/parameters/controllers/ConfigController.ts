import { $inject, t } from "alepha";
import { $action } from "alepha/server";
import type { ParameterStatus } from "../entities/parameters.ts";
import { ConfigStore } from "../services/ConfigStore.ts";

// Define response schemas inline to avoid complex entity schema issues
const parameterResponseSchema = t.object({
  id: t.uuid(),
  createdAt: t.datetime(),
  updatedAt: t.datetime(),
  name: t.text(),
  content: t.json(),
  schemaHash: t.text(),
  status: t.enum(["expired", "current", "next", "future"]),
  activationDate: t.datetime(),
  expiredAt: t.optional(t.datetime()),
  version: t.integer(),
  changeDescription: t.optional(t.text()),
  tags: t.optional(t.array(t.text())),
  creatorId: t.optional(t.uuid()),
  creatorName: t.optional(t.text()),
  previousContent: t.optional(t.json()),
  migrationLog: t.optional(t.text()),
});

const treeNodeSchema: any = t.object({
  name: t.text(),
  path: t.text(),
  isLeaf: t.boolean(),
  children: t.array(t.any()),
});

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
export class ConfigController {
  protected readonly store = $inject(ConfigStore);

  /**
   * Get tree structure of all configuration names.
   * Useful for admin UI navigation.
   */
  getConfigTree = $action({
    description:
      "Get tree structure of all configuration names for navigation.",
    path: "/configs/tree",
    method: "GET",
    schema: {
      response: t.array(treeNodeSchema),
    },
    handler: async () => {
      return this.store.getConfigTree();
    },
  });

  /**
   * List all unique configuration names.
   */
  listConfigNames = $action({
    description: "List all unique configuration names.",
    path: "/configs",
    method: "GET",
    schema: {
      response: t.object({
        names: t.array(t.text()),
      }),
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
    description: "Get all configurations with a specific status.",
    path: "/configs/status/:status",
    method: "GET",
    schema: {
      params: t.object({
        status: t.enum(["expired", "current", "next", "future"]),
      }),
      response: t.object({
        configs: t.array(parameterResponseSchema),
      }),
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
    description: "Get all versions of a specific configuration.",
    path: "/configs/:name/history",
    method: "GET",
    schema: {
      params: t.object({
        name: t.text({
          description: "Configuration name (e.g., app.features.flags)",
        }),
      }),
      response: t.object({
        versions: t.array(parameterResponseSchema),
      }),
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
    description: "Get current and next scheduled values for a configuration.",
    path: "/configs/:name",
    method: "GET",
    schema: {
      params: t.object({
        name: t.text({
          description: "Configuration name (e.g., app.features.flags)",
        }),
      }),
      response: t.object({
        current: t.optional(parameterResponseSchema),
        next: t.optional(parameterResponseSchema),
        defaultValue: t.optional(t.json()),
        currentValue: t.optional(t.json()),
        schema: t.optional(t.json()),
      }),
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
    description: "Get a specific version of a configuration.",
    path: "/configs/:name/versions/:version",
    method: "GET",
    schema: {
      params: t.object({
        name: t.text(),
        version: t.integer(),
      }),
      response: t.object({
        config: t.optional(parameterResponseSchema),
      }),
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
    description:
      "Create a new version of a configuration (immediate or scheduled).",
    path: "/configs/:name",
    method: "POST",
    schema: {
      params: t.object({
        name: t.text({
          description: "Configuration name (e.g., app.features.flags)",
        }),
      }),
      body: t.object({
        content: t.json({ description: "New configuration content" }),
        schemaHash: t.text({
          description: "Hash of the schema for migration detection",
        }),
        activationDate: t.optional(
          t.datetime({ description: "When to activate (default: now)" }),
        ),
        changeDescription: t.optional(
          t.text({ description: "Description of changes" }),
        ),
        tags: t.optional(t.array(t.text())),
        creatorId: t.optional(t.uuid()),
        creatorName: t.optional(t.text()),
      }),
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
    description:
      "Rollback a configuration to a previous version (creates new version with old content).",
    path: "/configs/:name/rollback",
    method: "POST",
    schema: {
      params: t.object({
        name: t.text(),
      }),
      body: t.object({
        targetVersion: t.integer({
          description: "Version number to rollback to",
        }),
        changeDescription: t.optional(t.text()),
        creatorId: t.optional(t.uuid()),
        creatorName: t.optional(t.text()),
      }),
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
    description: "Activate a future/next configuration version immediately.",
    path: "/configs/:name/activate",
    method: "POST",
    schema: {
      params: t.object({
        name: t.text(),
      }),
      body: t.object({
        version: t.integer({ description: "Version number to activate" }),
        creatorId: t.optional(t.uuid()),
        creatorName: t.optional(t.text()),
      }),
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
    description:
      "Manually trigger activation check for all scheduled configurations.",
    path: "/configs/activate-scheduled",
    method: "POST",
    schema: {
      response: t.object({
        message: t.text(),
      }),
    },
    handler: async () => {
      await this.store.activateScheduledConfigs();
      return { message: "Scheduled configuration activation check completed" };
    },
  });
}
