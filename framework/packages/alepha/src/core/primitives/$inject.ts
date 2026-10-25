import type { InstantiableClass, Service } from "../interfaces/Service.ts";
import { $context } from "./$context.ts";

/**
 * Get the instance of the specified type from the context.
 *
 * ```ts
 * class A { }
 * class B {
 *   a = $inject(A);
 * }
 * ```
 */
export const $inject = <T extends object>(
  type: Service<T>,
  opts: InjectOptions<T> = {},
): T => {
  const { alepha, service } = $context();

  // _ = $inject(Alepha)
  if (type === alepha.constructor) {
    return alepha as T;
  }

  return alepha.inject(type, {
    // keep the parent for better error messages and circular dependencies detection
    parent: service ?? (alepha.constructor as Service),
    ...opts,
  });
};

export interface InjectOptions<T extends object = any> {
  /**
   * - 'transient' → Always a new instance on every inject. Zero caching.
   * - 'singleton' → One instance per Alepha runtime (per-thread). Never disposed until Alepha shuts down. (default)
   * - 'scoped' → One instance per AsyncLocalStorage context.
   *   - A new scope is created when Alepha handles a request, a scheduled job, a queue worker task...
   *   - You can also start a manual scope via alepha.context.run(() => { ... }).
   *   - When the scope ends, the scoped registry is discarded.
   *
   * @default "singleton"
   */
  lifetime?: "transient" | "singleton" | "scoped";

  /**
   * Constructor arguments to pass when creating a new instance.
   */
  args?: ConstructorParameters<InstantiableClass<T>>;

  /**
   * Parent that requested the instance.
   *
   * @internal
   */
  parent?: Service | null;
}
