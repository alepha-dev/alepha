import type { Alepha } from "../Alepha.ts";
import { KIND } from "../constants/KIND.ts";
import { MODULE } from "../constants/MODULE.ts";
import { AlephaError } from "../errors/AlephaError.ts";
import type { PrimitiveFactoryLike } from "../helpers/primitive.ts";
import type { Service } from "../interfaces/Service.ts";
import type { Atom } from "./$atom.ts";

/**
 * Wrap Services and Primitives into a Module.
 *
 * - A module is just a Service with some extra {@link Module}.
 * - You must attach a `name` to it.
 * - Name must follow the pattern: `project.module.submodule`. (e.g. `myapp.users.auth`).
 *
 * @example
 * ```ts
 * import { $module } from "alepha";
 * import { MyService } from "./MyService.ts";
 *
 * export default $module({
 *  name: "my.project.module",
 *  services: [MyService],
 * });
 * ```
 *
 * ### Slots
 *
 * - `services[]`: always auto-injected. Module metadata attached.
 * - `variants[]`: module metadata attached but NOT auto-injected. Two typical uses:
 *   (1) alternative implementations picked at register-time via `alepha.with({ provide, use })`;
 *   (2) services whose instantiation is driven externally (e.g., the framework core).
 * - `imports[]`: other modules this one depends on. Wired after `register()`
 *   runs and before `services[]` are injected.
 * - `atoms[]`: registered on the store, first.
 * - `primitives[]`: tagged with module metadata.
 * - `register(alepha)`: purely additive side-effect hook. Runs after `atoms[]`
 *   and BEFORE `imports[]` are wired and `services[]` are auto-injected - so
 *   substitutions it records (e.g. `alepha.with({ provide, use })`) apply to
 *   the subsequent auto-injection. It can never suppress auto-registration.
 *
 * ### Why Modules?
 *
 * #### Logging
 *
 * By default, AlephaLogger will log the module name in the logs.
 * This helps to identify where the logs are coming from.
 *
 * You can also set different log levels for different modules.
 *
 * #### Modulith
 *
 * Force to structure your application in modules, even if it's a single deployable unit.
 * It helps to keep a clean architecture and avoid monolithic applications.
 *
 * ### When not to use Modules?
 *
 * Small applications do not need modules. Modules earn their keep when the application
 * grows - as a rule of thumb, once a module has 30+ `$actions`, consider splitting it.
 */
export const $module = (options: ModulePrimitiveOptions): Service<Module> => {
  const {
    services = [],
    variants = [],
    imports = [],
    primitives = [],
    name,
  } = options;

  if (!name || !Module.NAME_REGEX.test(name)) {
    throw new AlephaError(
      `Invalid module name '${name}'. It should be in the format of 'project.module.submodule'`,
    );
  }

  const $ = class extends Module {
    options = options;

    register(alepha: Alepha): void {
      if (options.atoms) {
        for (const atom of options.atoms) {
          alepha.store.register(atom);
        }
      }

      // register() runs BEFORE services so substitutions it records
      // (e.g. `alepha.with({ provide, use })`) apply to the subsequent auto-injection.
      options.register?.(alepha);

      for (const mod of imports) {
        alepha.with(mod);
      }

      for (const service of services) {
        alepha.inject(service, {
          parent: this.constructor as Service<Module>,
        });
      }
    }
  };

  Object.defineProperty($, "name", {
    value: name,
    writable: false,
  });

  // Attach MODULE metadata to services and variants alike — both "belong" to this module.
  for (const service of [...services, ...variants]) {
    if (!Module.is(service)) {
      (service as WithModule)[MODULE] = $;
    }
  }

  for (const factory of primitives) {
    if (typeof factory[KIND] === "function") {
      factory[KIND][MODULE] = $;
    }
  }

  return $;
};

// ---------------------------------------------------------------------------------------------------------------------

export interface ModulePrimitiveOptions {
  /**
   * Name of the module.
   *
   * It should be in the format of `project.module.submodule`.
   */
  name: string;

  /**
   * Services that belong to this module. All services listed here are:
   * - tagged with module metadata (used for logging, boundary checks)
   * - auto-injected when the module is registered
   *
   * If you need an alternative implementation that should NOT be eagerly instantiated
   * (picked at register-time instead), list it under `variants` instead.
   */
  services?: Array<Service>;

  /**
   * Alternative implementations that belong to this module but are NOT auto-injected.
   * Module metadata is still attached.
   *
   * Typical use: abstract provider in `services[]`, concrete impls here, with
   * `register()` choosing one via `alepha.with({ provide, use })`.
   *
   * @example
   * ```ts
   * $module({
   *   name: "alepha.email",
   *   services: [EmailProvider],
   *   variants: [MemoryEmailProvider, SmtpEmailProvider],
   *   register: (alepha) => {
   *     alepha.with({
   *       provide: EmailProvider,
   *       use: alepha.isTest() ? MemoryEmailProvider : SmtpEmailProvider,
   *     });
   *   },
   * });
   * ```
   */
  variants?: Array<Service>;

  /**
   * Other modules this module depends on. They are wired via `alepha.with(Module)`
   * after `register()` runs and before `services[]` are injected.
   *
   * Prefer this over calling `alepha.with(OtherModule)` manually inside `register()`.
   */
  imports?: Array<Service<Module>>;

  /**
   * List of $primitives to register in the module.
   */
  primitives?: Array<PrimitiveFactoryLike>;

  /**
   * Additive side-effect hook. Runs BEFORE `imports[]` are wired and
   * `services[]` are auto-injected — so substitutions it records apply to
   * the subsequent injection. Use it for:
   * - variant substitution: `alepha.with({ provide, use })`
   * - env parsing: `alepha.parseEnv(schema)`
   * - state seeding: `alepha.store.set(...)`
   *
   * It cannot suppress auto-registration — `services[]` are always injected.
   */
  register?: (alepha: Alepha) => void;

  /**
   * List of atoms to register in the module.
   */
  atoms?: Array<Atom<any>>;
}

/**
 * Base class for all modules.
 */
export abstract class Module {
  public abstract readonly options: ModulePrimitiveOptions;

  public abstract register(alepha: Alepha): void;

  static NAME_REGEX = /^[a-z-]+(\.[a-z-][a-z0-9-]*)*$/;

  /**
   * Check if a Service is a Module.
   */
  static is(ctor: Service): boolean {
    return ctor.prototype instanceof Module;
  }

  /**
   * Get the Module of a Service.
   *
   * Returns undefined if the Service is not part of a Module.
   */
  static of(ctor: Service): Service<Module> | undefined {
    return (ctor as WithModule)[MODULE];
  }
}

/**
 * Helper type to add Module metadata to a Service.
 */
export type WithModule<T extends object = any> = T & {
  [MODULE]?: Service;
};
