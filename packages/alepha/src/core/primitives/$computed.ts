import { KIND } from "../constants/KIND.ts";
import { AlephaError } from "../errors/AlephaError.ts";
import type { Atom, AtomStatic } from "./$atom.ts";

/**
 * Define a derived, read-only value computed from one or more atoms
 * (or other computed values).
 *
 * Dependencies are declared statically, which keeps the data flow explicit
 * and lets subscribers know exactly which mutations invalidate the value.
 *
 * Computed values are never stored, serialized, hydrated, or persisted -
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
 *
 * ### Footgun: a `serverOnly` dependency breaks hydration
 *
 * A computed whose deps include a `serverOnly` atom will NOT agree across the
 * SSR boundary. `serverOnly` keeps the atom out of the hydration payload, so
 * the server derives the value from the atom's real value while the browser
 * re-derives it from the atom's *default* - React then hydrates a DOM that
 * does not match the markup it received (a hydration mismatch, and a
 * silently wrong value afterwards).
 *
 * Either keep the computed server-side only (read it via `alepha.store.get`,
 * never through `useComputed`), or derive it from atoms that ship to the
 * browser. Note this cuts the other way too: if the value is safe to send to
 * the browser, the dependency should not have been `serverOnly` to begin
 * with.
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
   * Reentrancy guard for {@link keys}. Deps are declared as a `readonly`
   * array at construction time, so a cycle can't be built through the
   * public API — but the array itself isn't frozen, so nothing stops a
   * caller from reaching in and creating one anyway. Without this guard,
   * a cycle would recurse until the JS engine throws a native
   * `RangeError`, which violates the repo's "never throw a bare `Error`"
   * convention.
   */
  protected resolvingKeys = false;

  /**
   * Reentrancy guard for {@link compute}, same rationale as
   * {@link resolvingKeys}.
   */
  protected computing = false;

  /**
   * Transitive atom keys this computed value depends on. Subscribers
   * (useComputed, StateManager.watch) use this to know which `state:mutate`
   * events invalidate the value.
   */
  public keys(): string[] {
    if (this.resolvingKeys) {
      throw new AlephaError(
        `Circular $computed dependency detected at "${this.key}". A computed cannot depend on itself, even transitively.`,
      );
    }

    this.resolvingKeys = true;
    try {
      const out: string[] = [];
      for (const dep of this.options.deps as ReadonlyArray<AnyDep>) {
        if (dep instanceof Computed) {
          out.push(...dep.keys());
        } else {
          out.push(dep.key);
        }
      }
      return [...new Set(out)];
    } finally {
      this.resolvingKeys = false;
    }
  }

  /**
   * Resolve the value using the given dependency resolver.
   */
  public compute(resolve: (dep: AnyDep) => unknown): R {
    if (this.computing) {
      throw new AlephaError(
        `Circular $computed dependency detected at "${this.key}". A computed cannot depend on itself, even transitively.`,
      );
    }

    this.computing = true;
    try {
      const values = (this.options.deps as ReadonlyArray<AnyDep>).map(resolve);
      return this.options.get(...(values as DepValues<any>));
    } finally {
      this.computing = false;
    }
  }
}

$computed[KIND] = "computed";
