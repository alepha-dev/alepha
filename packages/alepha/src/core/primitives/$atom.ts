import type { z as zod } from "zod";
import { KIND } from "../constants/KIND.ts";
import type { Static, TObject } from "../providers/TypeProvider.ts";
import type { ZType } from "../providers/ZodProvider.ts";

/**
 * Define an atom for state management.
 *
 * Atom lets you define a piece of state with a name, schema, and default value.
 *
 * By default, Alepha state is just a simple key-value store.
 * Using atoms allows you to have type safety, validation, and default values for your state.
 *
 * You control how state is structured and validated.
 *
 * Features:
 * - Set a schema for validation
 * - Set a default value for initial state
 * - Rules, like read-only, custom validation, etc.
 * - Automatic getter access in services with {@link $use}
 * - SSR support (server state automatically serialized and hydrated on client)
 * - React integration (useAtom hook for automatic component re-renders)
 * - Middleware
 * - Persistence adapters (localStorage, Redis, database, file system, cookie, etc.)
 * - State migrations (version upgrades when schema changes)
 * - Documentation generation & devtools integration
 *
 * Common use cases:
 * - user preferences
 * - feature flags
 * - configuration options
 * - session data
 *
 * Atom must contain only serializable data.
 * Avoid storing complex objects like class instances, functions, or DOM elements.
 * If you need to store complex data, consider using identifiers or references instead.
 */
export const $atom = <T extends ZType, N extends string>(
  options: AtomOptions<T, N>,
): Atom<T, N> => {
  return new Atom<T, N>(options);
};

export type AtomOptions<T extends ZType, N extends string> = {
  name: N;
  schema: T;
  description?: string;
} & (T extends zod.ZodOptional<any>
  ? {
      default?: Static<T>;
    }
  : {
      default: Static<T>;
    });

export class Atom<T extends ZType = TObject, N extends string = string> {
  public readonly options: AtomOptions<T, N>;

  public get schema(): T {
    return this.options.schema;
  }

  public get key(): N {
    return this.options.name;
  }

  constructor(options: AtomOptions<T, N>) {
    this.options = options;
  }
}

$atom[KIND] = "atom";

export type TAtomObject = ZType;
export type AtomStatic<T extends ZType> =
  T extends zod.ZodOptional<any> ? Static<T> | undefined : Static<T>;
