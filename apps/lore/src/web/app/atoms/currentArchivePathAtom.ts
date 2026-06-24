import { $atom, z } from "alepha";

/**
 * Breadcrumb segments contributed by the Archive routes — appended to
 * the AppShell breadcrumb after "Lore > Archive". Examples:
 *
 *   `[]`                                       → "Lore › Archive"
 *   `[{name: "Notes", shortId: 4}]`            → "Lore › Archive › Notes"
 *   `[{...}, {name: "Bingo.md"}]`              → "Lore › Archive › Notes › Bingo.md"
 *
 * Each segment carries an optional `shortId` — present for directory
 * segments (the breadcrumb link navigates back via `?dir=<shortId>`)
 * and absent for the terminal folio title (the current page, not
 * clickable).
 *
 * ArchiveBrowser writes the directory chain on every refresh; FolioView
 * writes the same chain + appends the folio title. The atom is cleared
 * by the Archive route's `onLeave` so non-archive routes don't inherit
 * stale segments.
 */
export const currentArchivePathAtom = $atom({
  name: "lore.archive.currentPath",
  description:
    "Breadcrumb segments after Archive (directories + optional folio leaf).",
  schema: z.array(
    z.object({
      name: z.string(),
      shortId: z.integer().optional(),
    }),
  ),
  default: [],
});
