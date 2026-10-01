import type { Computed } from "alepha";
import { useCallback, useRef, useSyncExternalStore } from "react";

import { useAlepha } from "./useAlepha.ts";

/**
 * Subscribes to a `$computed` value.
 *
 * `getSnapshot` always reads the dependency atoms **live** off the store —
 * never through a subscription-set dirty flag. A dirty flag is only ever
 * flipped by the `state:mutate` listener registered in `subscribe`, which
 * React wires up in a passive effect (after commit); `EventManager.emit` is
 * async on top of that. A mutation dispatched between the initial render and
 * that effect committing would be invisible to the flag, so `getSnapshot`
 * (including React's own post-subscribe consistency re-check) would keep
 * returning the stale pre-mutation value. See `useStore.ts` and
 * `useSelector.ts` for the same rationale.
 *
 * Referential stability for `useSyncExternalStore` comes from comparing the
 * *inputs* (the resolved values of the computed's transitive atom
 * dependencies) by identity, not from caching on a mount-time ref: when none
 * of the inputs changed since the last snapshot, the previous output
 * reference is returned as-is; when any input changed (or `target` itself
 * was swapped for a different `Computed`), the value is recomputed and a new
 * reference is cached.
 *
 * A `Computed` passed here should be declared at module scope, like an
 * atom — constructing one inline in a component body creates a new
 * instance every render, which (because `subscribe`/`getSnapshot` are keyed
 * on `target.key`, matching `useStore`/`useSelector`) is tolerated for
 * resubscription purposes, but any closures captured by that instance's
 * `get()` will be locked to whichever render first created the subscription
 * until `target.key` itself changes.
 *
 * ```tsx
 * const total = useComputed(cartTotal);
 * ```
 */
function useComputed<R>(target: Computed<R>): R {
  const alepha = useAlepha();
  const key = target.key;

  // A ref, not state: the cached snapshot must survive re-renders without
  // scheduling them. It exists purely to give `useSyncExternalStore` a
  // stable reference when the resolved dependency values haven't changed —
  // it is never the source of truth for staleness (see rationale above).
  const cache = useRef<{
    target: Computed<R>;
    inputs: unknown[];
    value: R;
  } | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!alepha.isBrowser()) {
        return () => {};
      }

      const keys = new Set(target.keys());
      return alepha.events.on("state:mutate", (ev) => {
        if (keys.has(ev.key as string)) {
          onStoreChange();
        }
      });
    },
    [alepha, key],
  );

  const getSnapshot = useCallback((): R => {
    const inputs = target
      .keys()
      .map((depKey) => alepha.store.get(depKey as any));

    const prev = cache.current;
    if (
      prev &&
      prev.target === target &&
      prev.inputs.length === inputs.length &&
      prev.inputs.every((value, index) => Object.is(value, inputs[index]))
    ) {
      return prev.value;
    }

    const value = alepha.store.get(target);
    cache.current = { target, inputs, value };
    return value;
  }, [alepha, key]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export { useComputed };
