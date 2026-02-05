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
import type { ParameterPrimitive } from "../primitives/$parameter.ts";
import type { ParameterTreeNode } from "../schemas/parameterTreeNodeSchema.ts";

export type { ParameterTreeNode };

/**
 * Payload for parameter sync events across instances.
 */
export interface ParameterSyncPayload {
  name: string;
  version: number;
  content: unknown;
  status: ParameterStatus;
  instanceId: string;
}

/**
 * ParameterStore manages versioned parameter persistence and synchronization.
 *
 * Features:
 * - Stores all parameter versions in PostgreSQL
 * - Manages status transitions (future → next → current → expired)
 * - Provides cross-instance sync via topic
 * - Supports schema migrations via hash comparison
 * - Auto-activates scheduled parameters
 */
export class ParameterStore {
  protected readonly log = $logger();
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly repo = $repository(parameters);

  /**
   * Unique identifier for this instance (to avoid self-updates).
   */
  protected readonly instanceId = crypto.randomUUID();

  /**
   * In-memory cache of registered parameters.
   */
  protected readonly parameters = new Map<string, ParameterPrimitive<any>>();

  /**
   * Topic for cross-instance synchronization.
   */
  public readonly syncTopic = $topic({
    name: "parameter:sync",
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
      await this.handleSyncMessage(payload as ParameterSyncPayload);
    },
  });

  /**
   * Register a parameter primitive with the store.
   */
  public register(param: ParameterPrimitive<any>): void {
    this.parameters.set(param.name, param);
  }

  /**
   * Load the current parameter value from database.
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
   * Save a new parameter version.
   *
   * @param name - Parameter name (e.g., "app.features.flags")
   * @param content - New parameter content
   * @param schemaHash - Hash of the schema for migration detection
   * @param options - Additional options (activation date, creator info, etc.)
   */
  public async save<T extends TObject>(
    name: string,
    content: Static<T>,
    schemaHash: string,
    options: SaveParameterOptions = {},
  ): Promise<Parameter> {
    const now = this.dateTimeProvider.now().toDate();
    const activationDate = options.activationDate ?? now;
    const isImmediate = activationDate <= now;

    // Get current version number for this parameter
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
    const currentParam = versions.find((v) => v.status === "current");
    const previousContent = currentParam?.content;

    // Check for schema migration
    let migrationLog: string | undefined;
    if (latestVersion && latestVersion.schemaHash !== schemaHash) {
      migrationLog = `Schema changed from ${latestVersion.schemaHash} to ${schemaHash} at version ${newVersion}`;
      this.log.info("Parameter schema migration detected", {
        name,
        migrationLog,
      });
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

    this.log.info("Parameter saved", { name, version: newVersion, status });

    return inserted;
  }

  /**
   * Get all versions of a parameter.
   */
  public async getHistory(name: string): Promise<Parameter[]> {
    return this.repo.findMany({
      where: { name },
      orderBy: { column: "version", direction: "desc" },
    });
  }

  /**
   * Get a specific version of a parameter.
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
    options: SaveParameterOptions = {},
  ): Promise<Parameter> {
    const target = await this.getVersion(name, targetVersion);

    if (!target) {
      throw new Error(`Parameter version not found: ${name}@${targetVersion}`);
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
   * Get all parameters by status.
   */
  public async getByStatus(status: ParameterStatus): Promise<Parameter[]> {
    return this.repo.findMany({
      where: { status },
      orderBy: { column: "name", direction: "asc" },
    });
  }

  /**
   * Get current parameter value with fallback to default from registered primitive.
   * Returns the in-memory current value which may be the default if never saved.
   */
  public getCurrentValue(
    name: string,
  ): { content: unknown; isDefault: boolean } | null {
    const param = this.parameters.get(name);
    if (!param) {
      return null;
    }
    return {
      content: param.current,
      isDefault: true, // Will be updated after checking history
    };
  }

  /**
   * Get parameter info including current value with default fallback.
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
    const param = this.parameters.get(name);
    const defaultValue = param?.options.default ?? null;
    const currentValue = param?.current ?? null;
    const schema = param?.schema ?? null;

    return { current, next, defaultValue, currentValue, schema };
  }

  /**
   * Get all unique parameter names (for tree view).
   */
  public async getParameterNames(): Promise<string[]> {
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
   * Build a tree structure from parameter names for UI.
   * Includes both database parameters and registered (but not yet saved) parameters.
   */
  public async getParameterTree(): Promise<ParameterTreeNode[]> {
    const dbNames = await this.getParameterNames();
    const registeredNames = Array.from(this.parameters.keys());
    const allNames = [...new Set([...dbNames, ...registeredNames])].sort();
    return this.buildTree(allNames);
  }

  /**
   * Check and activate scheduled parameters that are due.
   * Should be called periodically (e.g., via scheduler).
   */
  public async activateScheduledParameters(): Promise<void> {
    const now = this.dateTimeProvider.now().toDate();

    // Find all NEXT parameters that should be activated
    const dueParams = await this.repo.findMany({
      where: { status: "next" },
    });

    for (const param of dueParams) {
      if (new Date(param.activationDate) <= now) {
        await this.transitionStatuses(param.name, now);
        await this.recalculateStatuses(param.name);

        // Notify registered parameter primitives
        const primitive = this.parameters.get(param.name);
        if (primitive) {
          await primitive.reload();
        }

        // Publish sync
        await this.publishSync(
          param.name,
          param.version,
          param.content,
          "current",
        );
      }
    }
  }

  /**
   * Transition parameter statuses when a new current is activated.
   */
  protected async transitionStatuses(name: string, now: Date): Promise<void> {
    // Find current parameters and expire them
    const currentParams = await this.repo.findMany({
      where: { name, status: "current" },
    });

    for (const param of currentParams) {
      await this.repo.updateById(param.id, {
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
  protected async handleSyncMessage(
    payload: ParameterSyncPayload,
  ): Promise<void> {
    // Ignore messages from self
    if (payload.instanceId === this.instanceId) {
      return;
    }

    const param = this.parameters.get(payload.name);
    if (!param) {
      return;
    }

    // Update parameter with skipEvents to avoid infinite loop
    if (payload.status === "current") {
      await param.updateFromSync(payload.content);
    }
  }

  /**
   * Build tree structure from dot-notation names.
   */
  protected buildTree(names: string[]): ParameterTreeNode[] {
    const root: ParameterTreeNode[] = [];

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

export interface SaveParameterOptions {
  activationDate?: Date;
  changeDescription?: string;
  tags?: string[];
  creatorId?: string;
  creatorName?: string;
}
