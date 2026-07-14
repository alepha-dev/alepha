import { KIND } from "../constants/KIND.ts";
import type { Atom, AtomStatic } from "./$atom.ts";

/**
 * Define a derived, read-only value computed from one or more atoms
 * (or other computed values).
 *
 * Dependencies are declared statically, which keeps the data flow explicit
 * and lets subscribers know exactly which mutations invalidate the value.
 *
 * Computed values are never stored, serialized, hydrated, or persisted —
 * they are recomputed from their dependencies on every read, so they are
 * always correct inside request-scoped (fork) state on the server.
 *
 * ```ts
 * const cartTotal = $computed({
 *   name: "cartTotal",
 *   deps: [cartAtom],
 *   get: (cart) => cart.items.reduce((sum, it) => sum + it.price, 0),
 * });
 *
 * alepha.store.get(cartTotal); // number
 * ```
 */
export const $computed = <
  const D extends ReadonlyArray<AnyDep>,
  R,
  N extends string = string,
>(
  options: ComputedOptions<D, R, N>,
): Computed<R, N> => {
  return new Computed<R, N>(options as ComputedOptions<any, R, N>);
};

export type AnyDep = Atom<any, any> | Computed<any, any>;

export type DepValues<D extends ReadonlyArray<AnyDep>> = {
  [K in keyof D]: D[K] extends Atom<infer T, any>
    ? AtomStatic<T>
    : D[K] extends Computed<infer R2, any>
      ? R2
      : never;
};

export interface ComputedOptions<
  D extends ReadonlyArray<AnyDep>,
  R,
  N extends string = string,
> {
  name: N;
  deps: D;
  get: (...values: DepValues<D>) => R;
  description?: string;
}

export class Computed<R = unknown, N extends string = string> {
  public readonly options: ComputedOptions<any, R, N>;

  constructor(options: ComputedOptions<any, R, N>) {
    this.options = options;
  }

  public get key(): N {
    return this.options.name;
  }

  /**
   * Transitive atom keys this computed value depends on. Subscribers
   * (useComputed, StateManager.watch) use this to know which `state:mutate`
   * events invalidate the value.
   */
  public keys(): string[] {
    const out: string[] = [];
    for (const dep of this.options.deps as ReadonlyArray<AnyDep>) {
      if (dep instanceof Computed) {
        out.push(...dep.keys());
      } else {
        out.push(dep.key);
      }
    }
    return [...new Set(out)];
  }

  /**
   * Resolve the value using the given dependency resolver.
   */
  public compute(resolve: (dep: AnyDep) => unknown): R {
    const values = (this.options.deps as ReadonlyArray<AnyDep>).map(resolve);
    return this.options.get(...(values as DepValues<any>));
  }
}

$computed[KIND] = "computed";
