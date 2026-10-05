import type { Atom } from "alepha";
import { useAlepha } from "alepha/react";
import { useCallback, useRef, useSyncExternalStore } from "react";

/**
 * Re-render when any of these atoms changes, and answer a number that moves
 * each time one does.
 *
 * `useStore` subscribes to ONE atom and is a hook, so a list of registered
 * entries cannot call it once per entry: a hook in a loop breaks the rules of
 * hooks, and the list is not fixed. The project shell (#E75, #Q2624) reads
 * module atoms through registered functions instead, and subscribes to every
 * atom they declare here, in one `useSyncExternalStore` on `state:mutate`.
 */
export const useAtomsVersion = (atoms: readonly Atom<any>[]): number => {
  const alepha = useAlepha();
  const version = useRef(0);
  const keys = atoms.map((atom) => atom.key).join("\n");

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!alepha.isBrowser()) {
        return () => {};
      }
      const watched = new Set(keys.split("\n"));
      return alepha.events.on("state:mutate", (ev) => {
        if (watched.has(String(ev.key))) {
          version.current += 1;
          onStoreChange();
        }
      });
    },
    [alepha, keys],
  );

  const getSnapshot = useCallback(() => version.current, []);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};
