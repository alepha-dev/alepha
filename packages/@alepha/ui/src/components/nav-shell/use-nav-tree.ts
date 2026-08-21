import type {
  NavGroup,
  NavItem,
} from "@alepha/ui/components/app-shell/app-shell";
import { useMemo } from "react";

import { type NavEntry, useNavEntries } from "./use-nav-entries.ts";

export interface UseNavTreeOptions {
  /**
   * Route name that anchors the shell (e.g. the `/admin` layout page). Only
   * its descendant pages with `nav` metadata become entries — this is what
   * lets an app host several shells (a `/` app shell and a `/admin` shell),
   * each scoped to its own subtree.
   */
  root: string;
}

/**
 * Derive sidebar navigation groups from the route tree. Built on the shared
 * {@link useNavEntries} (which handles filtering, permissions, `can`, labelling
 * and active-state); this hook only buckets the already-sorted entries into
 * `nav.group` sections for {@link AppShell}.
 *
 * This replaces the hand-synced nav list that used to live alongside the
 * router and breadcrumb definitions.
 */
export function useNavTree(options: UseNavTreeOptions): NavGroup[] {
  const entries = useNavEntries(options);

  return useMemo(() => {
    const groups: NavGroup[] = [];
    const byKey = new Map<string, NavItem[]>();

    for (const entry of entries) {
      const key = entry.group ?? "";
      let items = byKey.get(key);
      if (!items) {
        items = [];
        byKey.set(key, items);
        // Entries are pre-sorted by (groupOrder, order), so the first time we
        // see a group it lands in the right position.
        groups.push({ label: entry.group || undefined, items });
      }
      items.push(toNavItem(entry));
    }

    return groups;
  }, [entries]);
}

function toNavItem(entry: NavEntry): NavItem {
  return {
    label: entry.label,
    href: entry.href,
    icon: entry.icon,
    badge: entry.badge,
    tooltip: entry.description,
    disabled: entry.disabled,
    active: entry.active,
  };
}
