import { useRouterState } from "alepha/react/router";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { navLabel } from "./nav-tree-util.ts";

export interface UseNavBreadcrumbsOptions {
  /**
   * Route name anchoring the shell. The trail starts at this layer and walks
   * down to the active leaf; ancestors above it (e.g. the global app layout)
   * are dropped.
   */
  root: string;
}

export interface NavCrumb {
  label: ReactNode;
  href?: string;
}

/**
 * Derive the breadcrumb trail from the active route layers. Each rendered
 * layer that carries a route becomes a crumb (labelled via {@link navLabel});
 * the last one is the current page and is rendered without a link.
 *
 * Because the trail is the genuine nested-route chain, a detail page mounted
 * directly under the shell layout (rather than under its list page) yields
 * `Shell > Detail` — there is no synthetic "list" crumb in between.
 */
export function useNavBreadcrumbs(
  options: UseNavBreadcrumbsOptions,
): NavCrumb[] {
  const state = useRouterState();

  return useMemo(() => {
    const layers = state.layers ?? [];
    const rootIndex = layers.findIndex((l) => l.route?.name === options.root);
    const chain = rootIndex >= 0 ? layers.slice(rootIndex) : layers;

    const crumbs: NavCrumb[] = [];
    for (const layer of chain) {
      const route = layer.route;
      if (!route) continue;
      crumbs.push({ label: navLabel(route), href: route.match });
    }

    // The current page is a label, not a link.
    if (crumbs.length > 0) {
      crumbs[crumbs.length - 1] = { label: crumbs[crumbs.length - 1].label };
    }
    return crumbs;
  }, [state.layers, options.root]);
}
