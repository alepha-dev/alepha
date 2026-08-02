import type { Infer, State, TAtomObject } from "alepha";
import { Atom } from "alepha";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useAlepha } from "./useAlepha.ts";

/**
 * Hook to access and mutate the Alepha state.
 *
 * Reads through `useSyncExternalStore`, so the store — not a `useState` copy of
 * it — is the single source of truth. That is what keeps the value correct when
 * a mutation lands between render and effect-commit, when the component swaps
 * which `target` it watches, and when React renders concurrently (no tearing).
 */
function useStore<T extends TAtomObject>(
  target: Atom<T>,
  defaultValue?: Infer<T>,
): UseStoreReturn<Infer<T>>;
function useStore<Key extends keyof State>(
  target: Key,
  defaultValue?: State[Key],
): UseStoreReturn<State[Key]>;
function useStore(target: any, defaultValue?: any): any {
  const alepha = useAlepha();
  const key: string = target instanceof Atom ? target.key : target;

  // Seed during render (not in an effect) on purpose: effects don't run during
  // SSR, and the default has to be in the store before `exportAtoms` serializes
  // the hydration payload. Idempotent — only fills an empty slot.
  useMemo(() => {
    if (defaultValue != null && alepha.store.get(target) == null) {
      alepha.store.set(target, defaultValue);
    }
  }, [defaultValue, key]);

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

  // Read straight from the store rather than caching the event payload, so the
  // snapshot stays correct no matter who mutated the key or when.
  const getSnapshot = useCallback(
    () => alepha.store.get(target),
    [alepha, key],
  );

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setState = useCallback(
    (value: any) => {
      alepha.store.set(target, value);
    },
    [alepha, key],
  );

  return [state, setState] as const;
}

export type UseStoreReturn<T> = [T, (value: T) => void];

export { useStore };
