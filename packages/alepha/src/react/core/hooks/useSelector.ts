import type { Atom, Infer, TAtomObject } from "alepha";
import { useCallback, useRef, useSyncExternalStore } from "react";

import { useAlepha } from "./useAlepha.ts";

/**
 * Subscribes to a slice of an atom's state.
 *
 * Unlike {@link useStore}, which re-renders on every mutation of the atom,
 * `useSelector` re-renders only when the selected slice actually changes
 * according to `equality` (default: `Object.is`). Pass {@link shallowEqual}
 * when the selector builds a fresh object on each call.
 *
 * ```tsx
 * const theme = useSelector(uiAtom, (s) => s.theme);
 * ```
 */
function useSelector<T extends TAtomObject, R>(
  target: Atom<T>,
  select: (state: Infer<T>) => R,
  equality: (a: R, b: R) => boolean = Object.is,
): R {
  const alepha = useAlepha();
  const key = target.key;

  // Refs, not state: the memoized snapshot must survive re-renders without
  // scheduling them, and `getSnapshot` must return a referentially stable
  // value for unchanged slices or `useSyncExternalStore` re-renders forever.
  const cache = useRef<{ input: unknown; selected: R } | null>(null);
  const selectRef = useRef(select);
  selectRef.current = select;
  const equalityRef = useRef(equality);
  equalityRef.current = equality;

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!alepha.isBrowser()) {
        return () => {};
      }

      return alepha.events.on("state:mutate", (ev) => {
        if (ev.key === key) {
          onStoreChange();
        }
      });
    },
    [alepha, key],
  );

  const getSnapshot = useCallback(() => {
    const input = alepha.store.get(target);
    const prev = cache.current;
    if (prev && Object.is(prev.input, input)) {
      return prev.selected;
    }
    const selected = selectRef.current(input);
    if (prev && equalityRef.current(prev.selected, selected)) {
      cache.current = { input, selected: prev.selected };
      return prev.selected;
    }
    cache.current = { input, selected };
    return selected;
  }, [alepha, key]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export { useSelector };
