import { useStore } from "alepha/react";

import { uiAtom } from "../atoms/uiAtom.ts";

/**
 * Read and update the sidebar collapsed state. The value is persisted via the
 * `alepha-ui` cookie so it survives reloads and is available during SSR - no
 * flash of expanded-then-collapsed when the user prefers a collapsed shell.
 *
 * @example
 * const { collapsed, setCollapsed, toggle } = useSidebarState();
 */
export const useSidebarState = () => {
  const [state, set] = useStore(uiAtom);
  const collapsed = state?.sidebar.collapsed ?? false;

  const setCollapsed = (next: boolean) => {
    const base = state ?? uiAtom.options.default!;
    set({ ...base, sidebar: { ...base.sidebar, collapsed: next } });
  };

  return {
    collapsed,
    setCollapsed,
    toggle: () => setCollapsed(!collapsed),
  };
};
