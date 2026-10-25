import type { Async, Hook, Hooks } from "alepha";
import { type DependencyList, useEffect } from "react";

import { useAlepha } from "./useAlepha.ts";

/**
 * Allow subscribing to multiple Alepha events. See {@link Hooks} for available events.
 *
 * useEvents is fully typed to ensure correct event callback signatures.
 *
 * @example
 * ```tsx
 * useEvents(
 *   {
 *     "react:transition:begin": (ev) => {
 *       console.log("Transition began to:", ev.state.pathname);
 *     },
 *     "react:transition:error": {
 *       priority: "first",
 *       callback: (ev) => {
 *         console.error("Transition error:", ev.error);
 *       },
 *     },
 *   },
 *   [],
 * );
 * ```
 */
export const useEvents = (opts: UseEvents, deps: DependencyList) => {
  const alepha = useAlepha();

  useEffect(() => {
    if (!alepha.isBrowser()) {
      return;
    }

    const subs: Function[] = [];
    for (const [name, hook] of Object.entries(opts)) {
      subs.push(alepha.events.on(name as any, hook as any));
    }

    return () => {
      for (const clear of subs) {
        clear();
      }
    };
  }, deps);
};

type UseEvents = {
  [T in keyof Hooks]?: Hook<T> | ((payload: Hooks[T]) => Async<void>);
};
