import { useAlepha } from "alepha/react";
import { useEffect } from "react";

import { pageCrumbAtom } from "../../atoms/pageCrumbAtom.ts";

/**
 * Name the open page's own crumb, the last step of its trail (#Q3408), from
 * what the page itself has read. `undefined` while it loads draws no leaf.
 * The breadcrumb and the document title both follow, through `ProjectTrail`.
 */
export const usePageCrumb = (routeName: string, label: string | undefined) => {
  const alepha = useAlepha();
  useEffect(() => {
    if (!label) return;
    alepha.store.set(pageCrumbAtom, { routeName, label });
    return () => {
      // Only our own: the next page may already have written its leaf.
      const current = alepha.store.get(pageCrumbAtom);
      if (current?.routeName === routeName && current.label === label) {
        alepha.store.set(pageCrumbAtom, undefined);
      }
    };
  }, [alepha, routeName, label]);
};
