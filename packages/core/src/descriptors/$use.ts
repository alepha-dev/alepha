import type { State } from "../Alepha.ts";
import { OPTIONS } from "../constants/OPTIONS.ts";
import type { Static, TObject } from "../providers/TypeProvider.ts";
import type { Atom } from "./$atom.ts";
import { $context } from "./$context.ts";

export const $use = <T extends TObject, N extends string>(
  atom: Atom<T, N>,
): Static<T> => {
  const { alepha } = $context();

  // register atom in state if not already registered
  alepha.state.register(atom);

  const init = alepha.state.get(atom.key as keyof State) as object;

  return {
    [OPTIONS]: { getter: atom.key }, // alepha will replace this with by a real 'get prop()'
    ...init,
  } as Static<T>;
};
