import {
  AppShell,
  type AppShellProps,
  type NavGroup,
  type NavItem,
} from "@alepha/ui/components/app-shell/app-shell";
import { useRouterState } from "alepha/react/router";
import { useMemo } from "react";

import { isActivePath } from "./nav-tree-util.ts";
import { useNavBreadcrumbs } from "./use-nav-breadcrumbs.ts";
import { useNavTree } from "./use-nav-tree.ts";

export interface NavShellProps extends Omit<
  AppShellProps,
  "nav" | "breadcrumbs"
> {
  /**
   * Route name that anchors this shell — typically the layout `$page` mounted
   * at the shell's base path (e.g. `/admin`). The sidebar and breadcrumbs are
   * derived from this page's subtree, so an app can host several shells (a `/`
   * app shell and a `/admin` shell), each scoped to its own routes.
   */
  root: string;
  /**
   * Infer nav groups appended after the route-derived ones, for entries that
   * don't map to routes (external links, grouped sub-menus). Their `active`
   * state is computed from the current path (matching `href`), so callers only
   * supply structure. Most shells won't need this.
   */
  extraNav?: NavGroup[];
}

/**
 * Data-driven {@link AppShell}: the sidebar nav and breadcrumb trail are
 * derived from the route tree under `root` (via each `$page`'s `nav`
 * metadata), instead of hand-maintained lists. Everything else — brand,
 * top-bar actions, layout variant, fill — passes straight through to
 * `AppShell`.
 */
export const NavShell = (props: NavShellProps) => {
  const { root, extraNav, ...appShellProps } = props;
  const derived = useNavTree({ root });
  const breadcrumbs = useNavBreadcrumbs({ root });
  const state = useRouterState();
  const current = state.url?.pathname ?? "/";

  const nav = useMemo(() => {
    if (!extraNav?.length) return derived;
    return [
      ...derived,
      ...extraNav.map((group) => ({
        ...group,
        items: markActive(group.items, current),
      })),
    ];
  }, [derived, extraNav, current]);

  return <AppShell {...appShellProps} nav={nav} breadcrumbs={breadcrumbs} />;
};

/**
 * Recursively set `active` on static nav items by matching their `href`
 * against the current path (a parent group highlights when a descendant is
 * active).
 */
function markActive(items: NavItem[], current: string): NavItem[] {
  return items.map((item) => ({
    ...item,
    active: item.href ? isActivePath(current, item.href) : item.active,
    children: item.children
      ? markActive(item.children, current)
      : item.children,
  }));
}
