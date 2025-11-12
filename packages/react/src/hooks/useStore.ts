import type { State, Static, TAtomObject } from "@alepha/core";
import { Atom } from "@alepha/core";
import { useEffect, useMemo, useState } from "react";
import { useAlepha } from "./useAlepha.ts";

/**
 * Hook to access and mutate the Alepha state.
 */
function useStore<T extends TAtomObject>(
  target: Atom<T>,
  defaultValue?: Static<T>,
): UseStoreReturn<Static<T>>;
function useStore<Key extends keyof State>(
  target: Key,
  defaultValue?: State[Key],
): UseStoreReturn<State[Key]>;
function useStore(target: any, defaultValue?: any): any {
  const alepha = useAlepha();

  useMemo(() => {
    if (defaultValue != null && alepha.state.get(target) == null) {
      alepha.state.set(target, defaultValue);
    }
  }, [defaultValue]);

  const [state, setState] = useState(alepha.state.get(target));

  useEffect(() => {
    if (!alepha.isBrowser()) {
      return;
    }

    const key = target instanceof Atom ? target.key : target;

    return alepha.events.on("state:mutate", (ev) => {
      if (ev.key === key) {
        setState(ev.value);
      }
    });
  }, []);

  return [
    state,
    (value: any) => {
      alepha.state.set(target, value);
    },
  ] as const;
}

export type UseStoreReturn<T> = [T, (value: T) => void];

export { useStore };
