import { z } from "alepha";
import { useQueryParams } from "alepha/react/router";
import { useCallback } from "react";

/**
 * `.tsx` despite holding no JSX, like `useConfirmedAction.tsx`: both were named
 * when the package exported one wildcard subpath per component, which resolved
 * `.tsx` files only. Every consumer imports it through `@alepha/ui/shell` now,
 * so the extension no longer matters to anyone.
 */

/**
 * Module scope so its identity stays stable across renders — `useQueryParams`
 * anchors on it, and a fresh reference each render would re-decode for nothing.
 */
const tabSchema = z.object({ tab: z.string().optional() });

/**
 * Binds a detail page's selected tab to `?tab=<key>`.
 *
 * `format: "querystring"` makes `useQueryParams` write with `replaceState`, so
 * clicking through four tabs does not bury the page the operator arrived from
 * under four history entries. The URL still carries the tab, which is what
 * makes a deep link to "that user's sessions" shareable.
 *
 * The generic is the union of valid keys, so a caller gets `"overview" |
 * "stock"` back rather than `string`. An unknown `?tab=` value in the URL is
 * not validated here: it falls through to whatever the page renders for an
 * unmatched key, the same way a hand-edited query param always could.
 */
export const useDetailTab = <T extends string>(
  defaultTab: T,
): [T, (next: T) => void] => {
  const [query, setQuery] = useQueryParams(tabSchema, {
    format: "querystring",
  });

  const setTab = useCallback((next: T) => setQuery({ tab: next }), [setQuery]);

  return [(query.tab as T | undefined) ?? defaultTab, setTab];
};
