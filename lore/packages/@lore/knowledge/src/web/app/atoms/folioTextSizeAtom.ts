import { $atom, z } from "alepha";

/**
 * The reading size of the folio document, on a three-step scale.
 *
 * Level 3 is 18px and is what the folio has rendered at since the
 * 2026-08-28 typography exploration, so it is the default: turning a
 * fixed size into a preference must not silently move everyone off the
 * size they already have.
 *
 * ## One value drives both faces
 *
 * The levels resolve to `--folio-text-size` in `main.css`, which the
 * single rule under `[data-slot="folio-document"]` applies to
 * `.lore-md-view` (View) and `.cm-content` (Edit) together. The reader
 * cannot put the two faces on different sizes, and that is the point:
 * they share a `68ch` measure, so a size that applied to one of them
 * would re-break every line on ⌘E, which is the one thing a preview
 * toggle must not do.
 *
 * ## `persist: "cookie"`, not localStorage
 *
 * Matching `questLogCollapsedAtom` and `kanbanFiltersAtom`, and for their
 * reason: the folio route is server-rendered, and `$atom`'s Web Storage
 * adapters are invisible to the server. Under localStorage every folio
 * would paint at level 3 and snap to the reader's level on hydration, and
 * each server render would log the "persistence unavailable in this
 * environment" warning. A cookie is read while rendering, so the first
 * paint is already right.
 *
 * The value is a type size and never trust-bearing, so the "cookies are
 * attacker-controlled" caveat on `persist` does not bite: the worst a
 * forged cookie does is set someone's own text to a size they did not
 * choose, and an out-of-range one does not even do that — `$atom`
 * validates against the schema on read and falls back to the default.
 *
 * Global rather than per-project or per-folio: this is a statement about
 * the reader's eyes, not about one document.
 */
export const folioTextSizeAtom = $atom({
  name: "lor.folio.text-size",
  schema: z.object({
    level: z.integer().min(1).max(3),
  }),
  default: { level: 3 },
  persist: "cookie",
});
