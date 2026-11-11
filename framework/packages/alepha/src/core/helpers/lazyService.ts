import type { Service } from "../interfaces/Service.ts";

/**
 * A class whose code is imported on its first use (#Q3407): what
 * `alepha build` writes in a module file in place of a pure controller's
 * static import. It stands in `services: [...]` or `alepha.with(...)` like
 * the class, and the container declares it by the same key, then imports
 * the chunk before creating the class.
 *
 * Authors do not write it: the build does, from the build list.
 */
export interface LazyService {
  readonly name: string;
  readonly [LAZY_SERVICE]: {
    load: () => Promise<Service>;
    promise?: Promise<Service>;
    resolved?: Service;
  };
}

export const LAZY_SERVICE: unique symbol = Symbol.for("alepha.lazyService");

/**
 * The lazy stand-in of a class named `name`, imported by `load`.
 */
export const lazyService = (
  name: string,
  load: () => Promise<Service>,
): Service => {
  const lazy = { name, [LAZY_SERVICE]: { load } } as LazyService;
  return lazy as unknown as Service;
};

/**
 * Whether a registered entry is a lazy stand-in.
 */
export const isLazyService = (service: unknown): service is LazyService =>
  !!service &&
  typeof service === "object" &&
  LAZY_SERVICE in (service as object);
