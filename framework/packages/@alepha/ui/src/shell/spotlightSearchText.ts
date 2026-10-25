import type { ReactNode } from "react";

import type { NavEntry } from "./useNavEntries.ts";

/**
 * A `ReactNode` label as searchable text. A component label contributes
 * nothing, which is what `nav.keywords` is for.
 */
const toText = (node: ReactNode): string =>
  typeof node === "string" || typeof node === "number" ? String(node) : "";

/**
 * The text `Spotlight` finds a page by: its route name and label, then its
 * label again, description, `nav.keywords` and section heading.
 *
 * The same string cmdk scored when these were a row's `value` and `keywords`
 * (it joins the keywords onto the value with spaces), so a query ranks the
 * pages exactly as it did before the palette moved to Base UI.
 */
export const spotlightSearchText = (entry: NavEntry): string => {
  const keywords = [
    toText(entry.label),
    toText(entry.description),
    ...(entry.keywords ?? []),
    entry.groupLabel ?? entry.group ?? "",
  ].filter(Boolean);
  const value = `${entry.name} ${toText(entry.label)}`;
  return keywords.length > 0 ? `${value} ${keywords.join(" ")}` : value;
};
