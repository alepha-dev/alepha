import {
  createDescriptor,
  Descriptor,
  type Static,
  type TObject,
} from "alepha";
import type { UserAccount } from "alepha/security";

/**
 * Creates a configuration parameter descriptor for managing application settings.
 *
 * Provides type-safe, versioned configuration with schema validation, default values,
 * and scheduled activation. Useful for feature flags, system parameters, and runtime settings.
 *
 * @example
 * ```ts
 * class AppConfig {
 *   features = $config({
 *     name: "feature-flags",
 *     schema: t.object({
 *       enableBeta: t.boolean(),
 *       maxUploadSize: t.number()
 *     }),
 *     default: { enableBeta: false, maxUploadSize: 10485760 }
 *   });
 *
 *   async updateFeatures() {
 *     await this.features.set(
 *       { enableBeta: true, maxUploadSize: 20971520 },
 *       { user: currentUser, activationDate: tomorrow }
 *     );
 *   }
 * }
 * ```
 */
export interface ConfigDescriptorOptions<T extends TObject> {
  name?: string;
  description?: string;
  schema: T;
  default: Static<T>;
}

export class ConfigDescriptor<T extends TObject> extends Descriptor<
  ConfigDescriptorOptions<T>
> {
  public get name() {
    return this.options.name || this.config.propertyKey;
  }

  public get schema(): T {
    return this.options.schema;
  }

  public get current(): Static<T> {
    return this.options.default;
  }

  public get next(): Static<T> | undefined {
    return undefined;
  }

  public get<Key extends keyof Static<T>>(key: Key): Static<T>[Key] {
    return this.current[key];
  }

  /**
   * Apply a new configuration object.
   */
  public async set(
    value: Static<T>,
    options: {
      user?: UserAccount;
      activationDate?: Date; // default to now
    },
  ): Promise<void> {}

  public sub(fn: (curr: Static<T>) => void): void {}
}

export const $config = <T extends TObject>(
  options: ConfigDescriptorOptions<T>,
) => {
  return createDescriptor(ConfigDescriptor<T>, options);
};
