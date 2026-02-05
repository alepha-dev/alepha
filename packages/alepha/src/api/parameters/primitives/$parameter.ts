import {
  $hook,
  $inject,
  createPrimitive,
  KIND,
  Primitive,
  type Static,
  type TObject,
} from "alepha";
import { $logger } from "alepha/logger";
import type { UserAccount } from "alepha/security";
import { ParameterStore } from "../services/ParameterStore.ts";

/**
 * Creates a versioned parameter primitive for managing application settings.
 *
 * Provides type-safe, versioned configuration with:
 * - Schema validation with auto-migration detection
 * - Default values for initial state
 * - Scheduled activation (FUTURE, NEXT, CURRENT, EXPIRED statuses)
 * - PostgreSQL persistence with full version history
 * - Cross-instance synchronization via topic
 * - Tree view support via dot-notation naming (e.g., "app.features.flags")
 *
 * Integrates with Alepha's atom system for state management:
 * - Uses `alepha.set(atom, value)` for mutations
 * - Listens to `state:mutate` events to detect changes
 * - Auto-persists changes to database
 * - Syncs across instances via topic
 *
 * @example
 * ```ts
 * class AppConfig {
 *   features = $parameter({
 *     name: "app.features.flags",
 *     schema: t.object({
 *       enableBeta: t.boolean(),
 *       maxUploadSize: t.number()
 *     }),
 *     default: { enableBeta: false, maxUploadSize: 10485760 }
 *   });
 *
 *   async enableBeta() {
 *     // Immediate activation
 *     await this.features.set({ enableBeta: true, maxUploadSize: 20971520 });
 *   }
 *
 *   async scheduleBetaRelease() {
 *     // Schedule for future activation
 *     await this.features.set(
 *       { enableBeta: true, maxUploadSize: 20971520 },
 *       { activationDate: new Date('2024-03-01') }
 *     );
 *   }
 * }
 * ```
 */
export interface ParameterPrimitiveOptions<T extends TObject> {
  /**
   * Parameter name using dot notation for tree hierarchy.
   * Examples: "app.features", "app.pricing.tiers", "system.limits"
   */
  name?: string;

  /**
   * Human-readable description of the parameter.
   */
  description?: string;

  /**
   * TypeBox schema defining the parameter structure.
   */
  schema: T;

  /**
   * Default value used when no parameter exists in database.
   */
  default: Static<T>;
}

export class ParameterPrimitive<T extends TObject> extends Primitive<
  ParameterPrimitiveOptions<T>
> {
  protected readonly log = $logger();
  protected readonly store = $inject(ParameterStore);

  /**
   * Internal atom key for state management.
   */
  protected atomKey!: string;

  /**
   * Schema hash for migration detection.
   */
  protected schemaHash!: string;

  /**
   * Whether we're currently syncing (to avoid loops).
   */
  protected syncing = false;

  /**
   * Whether initial load has completed.
   */
  protected loaded = false;

  /**
   * Parameter name (uses property key if not specified).
   */
  public get name(): string {
    return this.options.name || this.config.propertyKey;
  }

  /**
   * The TypeBox schema for this parameter.
   */
  public get schema(): T {
    return this.options.schema;
  }

  /**
   * Get the current parameter value.
   */
  public get current(): Static<T> {
    return (
      (this.alepha.store.get(this.atomKey as any) as Static<T>) ??
      this.options.default
    );
  }

  /**
   * Get a specific field from the current parameter.
   */
  public get<Key extends keyof Static<T>>(key: Key): Static<T>[Key] {
    return this.current[key];
  }

  /**
   * Set a new parameter value.
   *
   * @param value - The new parameter value
   * @param options - Optional settings (activation date, creator info, etc.)
   */
  public async set(
    value: Static<T>,
    options: SetParameterOptions = {},
  ): Promise<void> {
    // Save to database
    await this.store.save(this.name, value, this.schemaHash, {
      activationDate: options.activationDate,
      changeDescription: options.changeDescription,
      tags: options.tags,
      creatorId: options.user?.id,
      creatorName: options.user?.name ?? options.user?.email,
    });

    // If immediate activation (no future date), update state
    const now = new Date();
    if (!options.activationDate || options.activationDate <= now) {
      this.syncing = true;
      try {
        this.alepha.store.set(this.atomKey as any, value);
      } finally {
        this.syncing = false;
      }
    }
  }

  /**
   * Subscribe to parameter changes.
   */
  public sub(fn: (curr: Static<T>) => void): () => void {
    return this.alepha.events.on("state:mutate", {
      callback: ({ key, value }) => {
        if (key === this.atomKey) {
          fn(value as Static<T>);
        }
      },
    });
  }

  /**
   * Reload parameter from database.
   * Called when scheduled parameter activates or sync message received.
   */
  public async reload(): Promise<void> {
    const value = await this.store.load<T>(this.name);
    if (value !== null) {
      this.syncing = true;
      try {
        this.alepha.store.set(this.atomKey as any, value, { skipEvents: true });
      } finally {
        this.syncing = false;
      }
    }
  }

  /**
   * Update from sync message (called by ParameterStore).
   * Uses skipEvents to avoid infinite loops.
   */
  public async updateFromSync(content: unknown): Promise<void> {
    this.syncing = true;
    try {
      this.alepha.store.set(this.atomKey as any, content as Static<T>, {
        skipEvents: true,
      });
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Get version history for this parameter.
   */
  public async getHistory() {
    return this.store.getHistory(this.name);
  }

  /**
   * Rollback to a specific version.
   */
  public async rollback(
    version: number,
    options?: SetParameterOptions,
  ): Promise<void> {
    await this.store.rollback(this.name, version, {
      changeDescription: options?.changeDescription,
      creatorId: options?.user?.id,
      creatorName: options?.user?.name ?? options?.user?.email,
    });
    await this.reload();
  }

  /**
   * Hook to load initial value from database on start.
   */
  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      await this.loadInitial();
    },
  });

  /**
   * Called after primitive creation to initialize.
   */
  protected onInit(): void {
    // Create unique key for state management
    this.atomKey = `parameter:${this.name}`;

    // Calculate schema hash for migration detection
    this.schemaHash = this.calculateSchemaHash();

    // Register with store
    this.store.register(this);

    // Set initial default using key-based state
    this.alepha.store.set(this.atomKey as any, this.options.default, {
      skipEvents: true,
    });

    // Listen for state mutations to detect external changes via alepha.set()
    // Note: state:mutate is not in Hooks interface, so we use events.on() directly
    this.alepha.events.on("state:mutate", {
      caller: this.config.service,
      callback: async ({ key, value, prevValue }) => {
        // Only handle our key
        if (key !== this.atomKey) {
          return;
        }

        // Skip if we're syncing (to avoid infinite loop)
        if (this.syncing) {
          return;
        }

        // Skip if value hasn't actually changed
        if (JSON.stringify(value) === JSON.stringify(prevValue)) {
          return;
        }

        // Auto-save to database when state is mutated via alepha.set()
        this.log.debug("Parameter state mutated, persisting to database", {
          name: this.name,
        });
        await this.store.save(this.name, value as Static<T>, this.schemaHash);
      },
    });
  }

  /**
   * Load initial value from database.
   */
  protected async loadInitial(): Promise<void> {
    if (this.loaded) {
      return;
    }

    const value = await this.store.load<T>(this.name);

    if (value !== null) {
      this.syncing = true;
      try {
        this.alepha.store.set(this.atomKey as any, value, { skipEvents: true });
      } finally {
        this.syncing = false;
      }
    }

    this.loaded = true;
  }

  /**
   * Calculate a hash of the schema for migration detection.
   */
  protected calculateSchemaHash(): string {
    const schemaJson = JSON.stringify(this.options.schema);
    // Simple hash - in production you might want a proper hash function
    let hash = 0;
    for (let i = 0; i < schemaJson.length; i++) {
      const char = schemaJson.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }
}

export const $parameter = <T extends TObject>(
  options: ParameterPrimitiveOptions<T>,
) => {
  return createPrimitive(ParameterPrimitive<T>, options);
};

$parameter[KIND] = ParameterPrimitive;

export interface SetParameterOptions {
  /**
   * User making the change (for audit trail).
   */
  user?: Pick<UserAccount, "id" | "email" | "name">;

  /**
   * When this parameter should become active.
   * Default is immediate (now).
   */
  activationDate?: Date;

  /**
   * Description of the change.
   */
  changeDescription?: string;

  /**
   * Tags for filtering/categorization.
   */
  tags?: string[];
}
