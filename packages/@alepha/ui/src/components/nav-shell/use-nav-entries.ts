import { useAuth } from "alepha/react/auth";
import { useRouter, useRouterState } from "alepha/react/router";
import type { ReactNode } from "react";
import { useMemo } from "react";

import {
  hasNavPermission,
  isActivePath,
  isDescendantOf,
  keepDeepestActive,
  navLabel,
} from "./nav-tree-util.ts";

export interface UseNavEntriesOptions {
  /**
   * Route name anchoring the shell — only descendant pages contribute entries.
   * See {@link UseNavTreeOptions}.
   */
  root: string;
}

/**
 * A single resolved navigation entry derived from a `$page`'s `nav` metadata.
 * Shared by the sidebar ({@link useNavTree}) and the command palette
 * ({@link Spotlight}) so both stay in sync from one source.
 */
export interface NavEntry {
  /** Route name — used for navigation (`router.push(name)`) and as a stable key. */
  name: string;
  /** Resolved pathname (the page's full `match`). */
  href: string;
  label: ReactNode;
  icon?: ReactNode;
  group?: string;
  /** `nav.order` within the group. */
  order: number;
  /** Smallest `order` in this entry's group — drives group ordering. */
  groupOrder: number;
  keywords?: string[];
  description?: ReactNode;
  badge?: ReactNode;
  /** `can()` returned `"disabled"` — show muted, block navigation. */
  disabled: boolean;
  /**
   * The current route is on or under this entry, and no sibling entry matched
   * it more specifically. At most one entry in a list is active — see
   * {@link keepDeepestActive}.
   */
  active: boolean;
}

/**
 * Flat, filtered, sorted list of nav entries for the subtree under `root`.
 * Filtering (hidden / permission / `can`), labelling and active-state matching
 * are applied here; consumers decide how to present them. Entries are sorted by
 * group order, then by item order.
 */
export function useNavEntries(options: UseNavEntriesOptions): NavEntry[] {
  const router = useRouter<any>();
  const state = useRouterState();
  const { has } = useAuth();
  const pages = router.pages;
  const current = state.url?.pathname ?? "/";

  return useMemo(() => {
    const entries: NavEntry[] = [];
    // Smallest order seen per group, so a group sorts by its earliest item.
    const groupOrders = new Map<string, number>();

    for (const page of pages) {
      const nav = page.nav;
      if (!nav || nav.hidden) continue;
      if (!isDescendantOf(page, options.root)) continue;
      if (!hasNavPermission(nav.permission, has)) continue;

      // `can` escape hatch: `false` hides, `"disabled"` shows muted.
      const canResult = page.can ? page.can({ has }) : true;
      if (canResult === false) continue;

      const order = nav.order ?? 0;
      const key = nav.group ?? "";
      const prev = groupOrders.get(key);
      if (prev === undefined || order < prev) groupOrders.set(key, order);

      entries.push({
        name: page.name,
        href: page.match,
        label: navLabel(page),
        icon: nav.icon,
        group: nav.group,
        order,
        groupOrder: 0,
        keywords: nav.keywords,
        description: nav.description,
        badge: nav.badge,
        disabled: canResult === "disabled",
        active: isActivePath(current, page.match),
      });
    }

    for (const entry of entries) {
      entry.groupOrder = groupOrders.get(entry.group ?? "") ?? 0;
    }
    entries.sort((a, b) => a.groupOrder - b.groupOrder || a.order - b.order);

    // `isActivePath` sees one entry at a time and so cannot tell that another
    // matched more specifically. Only now, with the whole set in hand, can the
    // shallower matches be dropped.
    return keepDeepestActive(entries);
  }, [pages, current, has, options.root]);
}
