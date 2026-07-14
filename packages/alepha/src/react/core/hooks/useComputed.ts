import type { Computed } from "alepha";
import { useCallback, useRef, useSyncExternalStore } from "react";
import { useAlepha } from "./useAlepha.ts";

/**
 * Subscribes to a `$computed` value.
 *
 * The value is recomputed lazily when one of its dependency atoms mutates.
 * A dirty-flag cache keeps `getSnapshot` referentially stable between
 * mutations, as `useSyncExternalStore` requires.
 *
 * ```tsx
 * const total = useComputed(cartTotal);
 * ```
 */
function useComputed<R>(target: Computed<R>): R {
  const alepha = useAlepha();
  const cache = useRef<{ dirty: boolean; value?: R }>({ dirty: true });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!alepha.isBrowser()) {
        return () => {};
      }

      const keys = new Set(target.keys());
      return alepha.events.on("state:mutate", (ev) => {
        if (keys.has(ev.key as string)) {
          cache.current.dirty = true;
          onStoreChange();
        }
      });
    },
    [alepha, target],
  );

  const getSnapshot = useCallback(() => {
    if (cache.current.dirty) {
      cache.current.value = alepha.store.get(target);
      cache.current.dirty = false;
    }
    return cache.current.value as R;
  }, [alepha, target]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export { useComputed };
