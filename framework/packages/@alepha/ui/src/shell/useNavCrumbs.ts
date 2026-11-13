import { useStore } from "alepha/react";
import { useEffect } from "react";

import { navCrumbsAtom } from "./navCrumbsAtom.ts";

/**
 * Replace a detail page's breadcrumb with crumbs of its own.
 *
 * While the page is mounted, route `route`'s crumb becomes `crumbs`:
 * `Admin > Users > Ada Lovelace` instead of `Admin > User`. The last crumb
 * is the open page and renders as a label.
 *
 * `undefined` leaves the route's own crumb, which is what a page shows
 * while what it names is still loading.
 */
export const useNavCrumbs = (
  route: string,
  crumbs: Array<{ label: string; href?: string }> | undefined,
): void => {
  const [, setCrumbs] = useStore(navCrumbsAtom);
  // Keyed on the content: the array is rebuilt on every render.
  const signature = JSON.stringify(crumbs ?? null);
  useEffect(() => {
    if (!crumbs) return;
    setCrumbs({ route, crumbs });
    return () => setCrumbs({ route: "", crumbs: [] });
  }, [route, signature, setCrumbs]);
};
