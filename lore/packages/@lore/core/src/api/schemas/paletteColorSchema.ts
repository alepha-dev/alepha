import { type Infer, z } from "alepha";

/**
 * The named colour tokens anything in a project can be tinted with.
 *
 * A token rather than a hex value, so the class it resolves to can carry a
 * CSS variable and stay legible in light and dark. Extracted here when tags
 * became the second consumer after `areas.color` — one palette, one picker
 * idiom, one literal class table on the client.
 *
 * ⚠️ Adding a token is a **three-place** change: this enum, the class table
 * (`AREA_DOT_CLASS` in `web/app/components/shared/areaColor.ts`) and the
 * chip table beside it. Tailwind scans source text, so a computed
 * `bg-${token}-400` compiles to nothing, silently — which is why the tables
 * are written out one literal at a time rather than generated from here.
 *
 * `mode: "text"` is applied at each column rather than here: it means "no
 * DB-level CHECK constraint", so extending the palette stays a code-only
 * change with no migration. Same reasoning as `epics.status` and
 * `folioLinks.targetType`.
 */
/**
 * The palette in order, for a picker that has to render every token.
 *
 * Declared as a const tuple and handed to `z.enum`, rather than read back
 * off the schema, so a picker maps over the same list the schema validates
 * against and the two cannot drift.
 */
export const PALETTE_COLORS = [
  "slate",
  "blue",
  "green",
  "amber",
  "red",
  "violet",
  "cyan",
  "pink",
] as const;

export const paletteColorSchema = z.enum(PALETTE_COLORS);

export type PaletteColor = Infer<typeof paletteColorSchema>;
