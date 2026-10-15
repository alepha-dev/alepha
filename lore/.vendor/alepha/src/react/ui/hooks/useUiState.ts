import { useAlepha } from "alepha/react";
import { useCallback, useSyncExternalStore } from "react";

import { uiAtom, type UiState } from "../atoms/uiAtom.ts";

/**
 * The visitor's UI preferences, read so that no server render ever depends
 * on them.
 *
 * The server and the client's hydration pass both see the DEFAULT
 * preferences: the server never reads `uiAtom` at all, so a page whose markup
 * uses this stays shareable by the page cache (#E78), and the first client
 * render agrees with any prerendered or cached HTML. The visitor's real value
 * arrives on the first commit after hydration.
 *
 * What must be right before that commit, the dark class, the theme class,
 * the collapsed sidebar, is painted by the boot script `UiPersistence`
 * injects, from the cookie, onto `<html>`.
 */
export const useUiState = (): [UiState, (next: UiState) => void] => {
  const alepha = useAlepha();

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!alepha.isBrowser()) {
        return () => {};
      }
      return alepha.events.on("state:mutate", (ev) => {
        if (ev.key === uiAtom.key) {
          onChange();
        }
      });
    },
    [alepha],
  );

  const state = useSyncExternalStore(
    subscribe,
    () => alepha.store.get(uiAtom) ?? uiAtom.options.default!,
    () => uiAtom.options.default!,
  );

  const set = useCallback(
    (next: UiState) => {
      alepha.store.set(uiAtom, next);
    },
    [alepha],
  );

  return [state, set];
};
