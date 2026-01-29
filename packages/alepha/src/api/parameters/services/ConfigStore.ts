import { $inject, type Static, type TObject, t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $topic } from "alepha/topic";
import {
  type Parameter,
  type ParameterStatus,
  parameters,
} from "../entities/parameters.ts";
import type { ConfigPrimitive } from "../primitives/$config.ts";

/**
 * Payload for config sync events across instances.
 */
export interface ConfigSyncPayload {
  name: string;
  version: number;
  content: unknown;
  status: ParameterStatus;
  instanceId: string;
}

/**
 * ConfigStore manages versioned configuration persistence and synchronization.
 *
 * Features:
 * - Stores all config versions in PostgreSQL
 * - Manages status transitions (future → next → current → expired)
 * - Provides cross-instance sync via topic
 * - Supports schema migrations via hash comparison
 * - Auto-activates scheduled configs
 */
export class ConfigStore {
  protected readonly log = $logger();
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly repo = $repository(parameters);

  /**
   * Unique identifier for this instance (to avoid self-updates).
   */
  protected readonly instanceId = crypto.randomUUID();

  /**
   * In-memory cache of registered configs.
   */
  protected readonly configs = new Map<string, ConfigPrimitive<any>>();

  /**
   * Topic for cross-instance synchronization.
   */
  public readonly syncTopic = $topic({
    name: "config:sync",
    schema: {
      payload: t.object({
        name: t.text(),
        version: t.integer(),
        content: t.json(),
        status: t.enum(["expired", "current", "next", "future"]),
        instanceId: t.text(),
      }),
    },
    handler: async ({ payload }) => {
      await this.handleSyncMessage(payload as ConfigSyncPayload);
    },
  });

  /**
   * Register a config primitive with the store.
   */
  public register(config: ConfigPrimitive<any>): void {
    this.configs.set(config.name, config);
  }

  /**
   * Load the current config value from database.
   * Returns the current or next version if no current exists.
   */
  public async load<T extends TObject>(
    name: string,
  ): Promise<Static<T> | null> {
    // First try to get CURRENT
    const all = await this.repo.findMany({
      where: { name },
      orderBy: { column: "version", direction: "desc" },
    });

    let param = all.find((p) => p.status === "current");

    // If no current, get NEXT (will become current)
    if (!param) {
      param = all
        .filter((p) => p.status === "next")
        .sort((a, b) => {
          return (
            new Date(a.activationDate).getTime() -
            new Date(b.activationDate).getTime()
          );
        })[0];
    }

    return param?.content as Static<T> | null;
  }

  /**
   * Save a new config version.
   *
   * @param name - Config name (e.g., "app.features.flags")
   * @param content - New config content
   * @param schemaHash - Hash of the schema for migration detection
   * @param options - Additional options (activation date, creator info, etc.)
   */
  public async save<T extends TObject>(
    name: string,
    content: Static<T>,
    schemaHash: string,
    options: SaveConfigOptions = {},
  ): Promise<Parameter> {
    const now = this.dateTimeProvider.now().toDate();
    const activationDate = options.activationDate ?? now;
    const isImmediate = activationDate <= now;

    // Get current version number for this config
    const versions = await this.repo.findMany({
      where: { name },
      orderBy: { column: "version", direction: "desc" },
    });

    const latestVersion = versions[0];
    const newVersion = (latestVersion?.version ?? 0) + 1;

    // Determine initial status
    let status: ParameterStatus = "future";
    if (isImmediate) {
      status = "current";
    }

    // Get previous content for rollback reference
    const currentConfig = versions.find((v) => v.status === "current");
    const previousContent = currentConfig?.content;

    // Check for schema migration
    let migrationLog: string | undefined;
    if (latestVersion && latestVersion.schemaHash !== schemaHash) {
      migrationLog = `Schema changed from ${latestVersion.schemaHash} to ${schemaHash} at version ${newVersion}`;
      this.log.info("Config schema migration detected", { name, migrationLog });
    }

    // If immediate activation, expire current and transition next to current
    if (isImmediate) {
      await this.transitionStatuses(name, now);
    }

    // Insert new version - convert Date to ISO string for datetime fields
    const inserted = await this.repo.create({
      name,
      content: content as Record<string, unknown>,
      schemaHash,
      status,
      activationDate: activationDate.toISOString(),
      version: newVersion,
      changeDescription: options.changeDescription,
      tags: options.tags,
      creatorId: options.creatorId,
      creatorName: options.creatorName,
      previousContent: previousContent as Record<string, unknown> | undefined,
      migrationLog,
    });

    // Recalculate statuses after insert
    await this.recalculateStatuses(name);

    // Publish sync event
    await this.publishSync(name, newVersion, content, status);

    this.log.info("Config saved", { name, version: newVersion, status });

    return inserted;
  }

  /**
   * Get all versions of a config.
   */
  public async getHistory(name: string): Promise<Parameter[]> {
    return this.repo.findMany({
      where: { name },
      orderBy: { column: "version", direction: "desc" },
    });
  }

  /**
   * Get a specific version of a config.
   */
  public async getVersion(
    name: string,
    version: number,
  ): Promise<Parameter | null> {
    const versions = await this.repo.findMany({
      where: { name, version },
    });
    return versions[0] ?? null;
  }

  /**
   * Rollback to a previous version by creating a new version with old content.
   */
  public async rollback(
    name: string,
    targetVersion: number,
    options: SaveConfigOptions = {},
  ): Promise<Parameter> {
    const target = await this.getVersion(name, targetVersion);

    if (!target) {
      throw new Error(`Config version not found: ${name}@${targetVersion}`);
    }

    return this.save(
      name,
      target.content as Static<TObject>,
      target.schemaHash,
      {
        ...options,
        changeDescription:
          options.changeDescription ?? `Rollback to version ${targetVersion}`,
      },
    );
  }

  /**
   * Get all configs by status.
   */
  public async getByStatus(status: ParameterStatus): Promise<Parameter[]> {
    return this.repo.findMany({
      where: { status },
      orderBy: { column: "name", direction: "asc" },
    });
  }

  /**
   * Get current config value with fallback to default from registered primitive.
   * Returns the in-memory current value which may be the default if never saved.
   */
  public getCurrentValue(
    name: string,
  ): { content: unknown; isDefault: boolean } | null {
    const config = this.configs.get(name);
    if (!config) {
      return null;
    }
    return {
      content: config.current,
      isDefault: true, // Will be updated after checking history
    };
  }

  /**
   * Get config info including current value with default fallback.
   */
  public async getCurrentWithDefault(name: string): Promise<{
    current: Parameter | null;
    next: Parameter | null;
    defaultValue: unknown | null;
    currentValue: unknown | null;
    schema: TObject | null;
  }> {
    const history = await this.getHistory(name);
    const current = history.find((v) => v.status === "current") ?? null;
    const next = history.find((v) => v.status === "next") ?? null;

    // Get default and current from registered primitive
    const config = this.configs.get(name);
    const defaultValue = config?.options.default ?? null;
    const currentValue = config?.current ?? null;
    const schema = config?.schema ?? null;

    return { current, next, defaultValue, currentValue, schema };
  }

  /**
   * Get all unique config names (for tree view).
   */
  public async getConfigNames(): Promise<string[]> {
    const results = await this.repo.findMany({
      orderBy: { column: "name", direction: "asc" },
    });

    const names = new Set<string>();
    for (const r of results) {
      names.add(r.name);
    }

    return Array.from(names);
  }

  /**
   * Build a tree structure from config names for UI.
   * Includes both database configs and registered (but not yet saved) configs.
   */
  public async getConfigTree(): Promise<ConfigTreeNode[]> {
    const dbNames = await this.getConfigNames();
    const registeredNames = Array.from(this.configs.keys());
    const allNames = [...new Set([...dbNames, ...registeredNames])].sort();
    return this.buildTree(allNames);
  }

  /**
   * Check and activate scheduled configs that are due.
   * Should be called periodically (e.g., via scheduler).
   */
  public async activateScheduledConfigs(): Promise<void> {
    const now = this.dateTimeProvider.now().toDate();

    // Find all NEXT configs that should be activated
    const dueConfigs = await this.repo.findMany({
      where: { status: "next" },
    });

    for (const config of dueConfigs) {
      if (new Date(config.activationDate) <= now) {
        await this.transitionStatuses(config.name, now);
        await this.recalculateStatuses(config.name);

        // Notify registered config primitives
        const primitive = this.configs.get(config.name);
        if (primitive) {
          await primitive.reload();
        }

        // Publish sync
        await this.publishSync(
          config.name,
          config.version,
          config.content,
          "current",
        );
      }
    }
  }

  /**
   * Transition config statuses when a new current is activated.
   */
  protected async transitionStatuses(name: string, now: Date): Promise<void> {
    // Find current configs and expire them
    const currentConfigs = await this.repo.findMany({
      where: { name, status: "current" },
    });

    for (const config of currentConfigs) {
      await this.repo.updateById(config.id, {
        status: "expired",
        expiredAt: now.toISOString(),
      });
    }
  }

  /**
   * Recalculate statuses based on activation dates.
   */
  protected async recalculateStatuses(name: string): Promise<void> {
    const now = this.dateTimeProvider.now().toDate();

    // Get all versions ordered by activation date
    const versions = await this.repo.findMany({
      where: { name },
      orderBy: { column: "activationDate", direction: "asc" },
    });

    const nonExpired = versions.filter(
      (v: Parameter) => v.status !== "expired",
    );

    // Find which should be current (latest activated)
    const shouldBeCurrent = nonExpired
      .filter((v: Parameter) => new Date(v.activationDate) <= now)
      .pop();

    // Find which should be next (closest future)
    const futureVersions = nonExpired.filter(
      (v: Parameter) => new Date(v.activationDate) > now,
    );
    const shouldBeNext = futureVersions[0];

    for (const v of nonExpired) {
      let newStatus: ParameterStatus;

      if (shouldBeCurrent && v.id === shouldBeCurrent.id) {
        newStatus = "current";
      } else if (shouldBeNext && v.id === shouldBeNext.id) {
        newStatus = "next";
      } else if (new Date(v.activationDate) > now) {
        newStatus = "future";
      } else {
        newStatus = "expired";
      }

      if (v.status !== newStatus) {
        await this.repo.updateById(v.id, {
          status: newStatus,
          expiredAt: newStatus === "expired" ? now.toISOString() : undefined,
        });
      }
    }
  }

  /**
   * Publish sync event to other instances.
   */
  protected async publishSync(
    name: string,
    version: number,
    content: unknown,
    status: ParameterStatus,
  ): Promise<void> {
    await this.syncTopic.publish({
      name,
      version,
      content: content as Record<string, unknown>,
      status,
      instanceId: this.instanceId,
    });
  }

  /**
   * Handle incoming sync message from other instances.
   */
  protected async handleSyncMessage(payload: ConfigSyncPayload): Promise<void> {
    // Ignore messages from self
    if (payload.instanceId === this.instanceId) {
      return;
    }

    const config = this.configs.get(payload.name);
    if (!config) {
      return;
    }

    // Update config with skipEvents to avoid infinite loop
    if (payload.status === "current") {
      await config.updateFromSync(payload.content);
    }
  }

  /**
   * Build tree structure from dot-notation names.
   */
  protected buildTree(names: string[]): ConfigTreeNode[] {
    const root: ConfigTreeNode[] = [];

    for (const name of names) {
      const parts = name.split(".");
      let currentLevel = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLeaf = i === parts.length - 1;
        const path = parts.slice(0, i + 1).join(".");

        let existing = currentLevel.find((n) => n.name === part);

        if (!existing) {
          existing = {
            name: part,
            path,
            isLeaf,
            children: [],
          };
          currentLevel.push(existing);
        }

        if (isLeaf) {
          existing.isLeaf = true;
        }

        currentLevel = existing.children;
      }
    }

    return root;
  }
}

export interface SaveConfigOptions {
  activationDate?: Date;
  changeDescription?: string;
  tags?: string[];
  creatorId?: string;
  creatorName?: string;
}

export interface ConfigTreeNode {
  name: string;
  path: string;
  isLeaf: boolean;
  children: ConfigTreeNode[];
}
