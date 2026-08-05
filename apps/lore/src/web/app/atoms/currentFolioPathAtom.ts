import { $atom, z } from "alepha";

/**
 * Breadcrumb segments contributed by the Folio routes — appended to
 * the AppShell breadcrumb after "Lore > Folios". Examples:
 *
 *   `[]`                                       → "Lore › Folios"
 *   `[{name: "Notes", shortId: 4}]`            → "Lore › Folios › Notes"
 *   `[{...}, {name: "Bingo.md"}]`              → "Lore › Folios › Notes › Bingo.md"
 *
 * Each segment carries an optional `shortId` — present for directory
 * segments (the breadcrumb link navigates back via `?dir=<shortId>`)
 * and absent for the terminal folio title (the current page, not
 * clickable).
 *
 * FolioBrowser writes the directory chain on every refresh; FolioView
 * writes the same chain + appends the folio title. The atom is cleared
 * by the Folio route's `onLeave` so non-folio routes don't inherit
 * stale segments.
 */
export const currentFolioPathAtom = $atom({
  name: "lore.folio.currentPath",
  description:
    "Breadcrumb segments after Folios (directories + optional folio leaf).",
  schema: z.array(
    z.object({
      name: z.string(),
      shortId: z.integer().optional(),
    }),
  ),
  default: [],
});
