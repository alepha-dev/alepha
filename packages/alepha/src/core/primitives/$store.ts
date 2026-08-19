import { OPTIONS } from "../constants/OPTIONS.ts";
import type { Infer } from "../providers/ZodProvider.ts";
import { Atom, type TAtomObject } from "./$atom.ts";
import type { Computed } from "./$computed.ts";
import { $context } from "./$context.ts";

/**
 * Reads a value out of the application store from a class property.
 *
 * The declarative counterpart of `alepha.store.get(target)` - same store, same
 * operation, expressed as a class member instead of an imperative call. The
 * property is reactive: it re-reads on every access, so a mutation made
 * elsewhere is visible immediately.
 *
 * Accepts either side of the state model:
 * - an {@link Atom} - read from the store, and registered on first use if it
 *   was not already
 * - a {@link Computed} - derived from its dependencies on every read. Computed
 *   values are never stored, so nothing is registered.
 *
 * **Use cases**: global state, configuration, sharing data between services,
 * reading a derived value without wiring its dependencies by hand.
 *
 * @example Reading an atom
 * ```ts
 * const userState = $atom({
 *   name: "user.state",
 *   schema: z.object({ name: z.text(), role: z.text() }),
 *   default: { name: "", role: "guest" },
 * });
 *
 * class UserService {
 *   user = $store(userState);
 *
 *   greet() {
 *     return `Hello ${this.user.name}!`;
 *   }
 * }
 * ```
 *
 * @example Reading a computed
 * ```ts
 * const cartTotal = $computed({
 *   name: "cart.total",
 *   deps: [cartAtom],
 *   get: (cart) => cart.items.reduce((sum, it) => sum + it.price, 0),
 * });
 *
 * class CheckoutService {
 *   total = $store(cartTotal); // number, re-derived on every read
 * }
 * ```
 */
export function $store<T extends TAtomObject, N extends string>(
  atom: Atom<T, N>,
): Readonly<Infer<T>>;
export function $store<R>(computed: Computed<R>): Readonly<R>;
export function $store(target: Atom<any, any> | Computed<any>): any {
  const { alepha } = $context();

  // Only atoms live in the store. A computed is derived on every read, and
  // `StateManager.register` throws on one by design — so the registration is
  // conditional, not a step that can be applied uniformly.
  if (target instanceof Atom) {
    alepha.store.register(target);
  }

  const init = alepha.store.get(target as any) as object;

  return {
    // Alepha replaces this with a real `get prop()` during instantiation.
    // The marker carries the target ITSELF rather than its key: a computed has
    // a `key` but no store entry under it, so resolving by key would read
    // `undefined`. `StateManager.get` is already overloaded on
    // `Computed | Atom | string`, so handing it the object covers both.
    [OPTIONS]: { getter: target },
    ...init,
  };
}
