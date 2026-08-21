import {
  $inject,
  createPrimitive,
  type Infer,
  KIND,
  Primitive,
  type ZObject,
} from "alepha";
import type { UserAccount } from "alepha/security";

import { ParameterProvider } from "../services/ParameterProvider.ts";

/**
 * Creates a versioned parameter primitive for managing application settings.
 *
 * Provides type-safe, versioned configuration with:
 * - Schema validation with auto-migration detection
 * - Default values for initial state
 * - Status derived from activationDate (no stored status)
 * - Database persistence with full version history
 * - Cross-instance notification via topic
 * - Tree view support via dot-notation naming (e.g., "app.features.flags")
 * - Async `.get()` with lazy loading (works in Node and Cloudflare Workers)
 *
 * @example
 * ```ts
 * class AppConfig {
 *   features = $parameter({
 *     name: "app.features.flags",
 *     schema: z.object({
 *       enableBeta: z.boolean(),
 *       maxUploadSize: z.number()
 *     }),
 *     default: { enableBeta: false, maxUploadSize: 10485760 }
 *   });
 *
 *   async checkBeta() {
 *     const config = await this.features.get();
 *     return config.enableBeta;
 *   }
 *
 *   async enableBeta() {
 *     await this.features.set({ enableBeta: true, maxUploadSize: 20971520 });
 *   }
 * }
 * ```
 */
export interface ParameterPrimitiveOptions<T extends ZObject> {
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
   * Zod schema defining the parameter structure.
   */
  schema: T;

  /**
   * Default value used when no parameter exists in database.
   */
  default: Infer<T>;

  /**
   * Optional migration function for schema changes.
   * Receives the raw DB value and returns a transformed value matching the new schema.
   * Runs before validation — if the result is valid, it's used directly.
   * If not provided or returns an invalid value, falls through to merge/default cascade.
   */
  migrate?: (old: unknown) => Infer<T>;
}

export class ParameterPrimitive<T extends ZObject> extends Primitive<
  ParameterPrimitiveOptions<T>
> {
  protected readonly provider = $inject(ParameterProvider);

  /**
   * Parameter name (uses property key if not specified).
   */
  public get name(): string {
    return (
      this.options.name ||
      `${this.config.service.name}.${this.config.propertyKey}`
    );
  }

  /**
   * The Zod schema for this parameter.
   */
  public get schema(): T {
    return this.options.schema;
  }

  /**
   * Get the cached current content, falling back to default.
   * Synchronous access for admin API.
   */
  public get cachedCurrentContent(): Infer<T> {
    return this.provider.getCachedCurrentContent(this.name) as Infer<T>;
  }

  /**
   * Whether the parameter is using its default value (no DB value loaded).
   */
  public get isUsingDefault(): boolean {
    return this.provider.isUsingDefault(this.name);
  }

  /**
   * Get the current parameter value asynchronously.
   * Lazy-loads from database on first call.
   * Checks if a cached next version has become current.
   */
  public get(): Promise<Infer<T>> {
    return this.provider.get(this.name) as Promise<Infer<T>>;
  }

  /**
   * Load current and next values from database.
   */
  public async load(): Promise<void> {
    await this.provider.load(this.name);
  }

  /**
   * Set a new parameter value.
   *
   * @param value - The new parameter value
   * @param options - Optional settings (activation date, creator info, etc.)
   */
  public async set(
    value: Infer<T>,
    options: SetParameterOptions = {},
  ): Promise<void> {
    await this.provider.set(this.name, value, {
      activationDate: options.activationDate,
      changeDescription: options.changeDescription,
      tags: options.tags,
      creatorId: options.user?.id,
      creatorName: options.user?.name ?? options.user?.email,
    });
  }

  /**
   * Subscribe to parameter changes.
   * Returns an unsubscribe function.
   */
  public sub(fn: (curr: Infer<T>) => void): () => void {
    return this.provider.sub(this.name, fn as (v: unknown) => void);
  }

  /**
   * Reload parameter from database.
   * Called when sync notification received or for manual refresh.
   */
  public async reload(): Promise<void> {
    await this.provider.load(this.name);
  }

  /**
   * Get version history for this parameter.
   */
  public async getHistory(options?: { limit?: number; offset?: number }) {
    return this.provider.getHistory(this.name, options);
  }

  /**
   * Get a specific version of this parameter.
   */
  public async getVersion(version: number) {
    return this.provider.getVersion(this.name, version);
  }

  /**
   * Get the version of this parameter that was in force at `at` — use it when
   * a decision belongs to the time of an EVENT rather than the time of the
   * read (an offline capture uploaded later must be evaluated with the values
   * that were live when it happened). `null` when `at` predates version 1.
   *
   * @see ParameterProvider.getVersionAt
   */
  public async getVersionAt(at: string | Date) {
    return this.provider.getVersionAt(this.name, at);
  }

  /**
   * Delete all versions of this parameter.
   */
  public async delete(): Promise<void> {
    await this.provider.delete(this.name);
  }

  /**
   * Rollback to a specific version.
   */
  public async rollback(
    version: number,
    options?: SetParameterOptions,
  ): Promise<void> {
    await this.provider.rollback(this.name, version, {
      changeDescription: options?.changeDescription,
      creatorId: options?.user?.id,
      creatorName: options?.user?.name ?? options?.user?.email,
    });
    await this.provider.load(this.name);
  }

  /**
   * Called after primitive creation to register with provider.
   */
  protected onInit(): void {
    this.provider.register(this);
  }
}

/**
 * Declares a named, schema-validated runtime parameter - configuration that
 * lives in the database, is editable from the admin UI, and is versioned with
 * `rollback()`. Read it with `get()`; every change records who made it.
 *
 * @example
 * ```typescript
 * class FeatureFlags {
 *   checkout = $parameter({
 *     name: "checkout.flags",
 *     schema: z.object({ oneClick: z.boolean() }),
 *     default: { oneClick: false },
 *   });
 *
 *   async isOneClickEnabled() {
 *     return (await this.checkout.get()).oneClick;
 *   }
 * }
 * ```
 */
export const $parameter = <T extends ZObject>(
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
