import type { State } from "../Alepha.ts";
import { OPTIONS } from "../constants/OPTIONS.ts";
import type { Static } from "../providers/TypeProvider.ts";
import type { Atom, TAtomObject } from "./$atom.ts";
import { $context } from "./$context.ts";

/**
 * Subscribes to an atom's state and returns its current value for use in components.
 *
 * Creates a reactive connection between an atom and a component, automatically registering
 * the atom in the application state if not already registered. The returned value is reactive
 * and will update when the atom's state changes.
 *
 * **Use Cases**: Accessing global state, sharing data between components, reactive UI updates
 *
 * @example
 * ```ts
 * const userState = $atom({
 *   name: "user.state",
 *   schema: z.object({ name: z.text(), role: z.text() }),
 *   default: { name: "", role: "guest" },
 * });
 *
 * class UserComponent {
 *   user = $state(userState); // Reactive reference to atom state
 *
 *   render() {
 *     return <div>Hello {this.user.name}!</div>;
 *   }
 * }
 * ```
 */
export const $state = <T extends TAtomObject, N extends string>(
  atom: Atom<T, N>,
): Readonly<Static<T>> => {
  const { alepha } = $context();

  // register atom in state if not already registered
  alepha.store.register(atom);

  const init = alepha.store.get(atom.key as keyof State) as object;

  return {
    [OPTIONS]: { getter: atom.key }, // alepha will replace this with by a real 'get prop()'
    ...init,
  } as Static<T>;
};
