import { useUiState } from "./useUiState.ts";

/**
 * Read and update the sidebar collapsed state. The value is persisted via the
 * `alepha-ui` cookie so it survives reloads.
 *
 * ## The server never reads it
 *
 * The server render and the hydration pass both see the default (expanded),
 * whatever the visitor's cookie says (see `useUiState`). The shell's markup
 * is therefore the same for every visitor, which keeps its pages shareable
 * by the page cache (#E78) and keeps prerendered pages free of hydration
 * mismatches (#Q2347). The preference arrives on the first commit after
 * hydration.
 *
 * Until then, the boot script `UiPersistence` injects has already put
 * `data-sidebar="collapsed"` on `<html>` from the cookie, and `@alepha/ui`'s
 * stylesheet holds an expanded sidebar at its collapsed width under that
 * attribute: no flash of the wide sidebar. Updating the preference keeps the
 * attribute in step.
 *
 * @example
 * const { collapsed, setCollapsed, toggle } = useSidebarState();
 */
export const useSidebarState = () => {
  const [state, set] = useUiState();
  const collapsed = state.sidebar.collapsed;

  const setCollapsed = (next: boolean) => {
    set({ ...state, sidebar: { ...state.sidebar, collapsed: next } });
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute(
        "data-sidebar",
        next ? "collapsed" : "expanded",
      );
    }
  };

  return {
    collapsed,
    setCollapsed,
    toggle: () => setCollapsed(!collapsed),
  };
};
