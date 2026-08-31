import type { AreaResource } from "@/api/schemas/areaResourceSchema.ts";
import type { PaletteColor } from "@/api/schemas/paletteColorSchema.ts";

/**
 * A palette token resolved to a dot class.
 *
 * The questline was the first surface in Lore to render `areas.color` at
 * all; the kanban card is the second, which is why this module moved out of
 * `questline/`. Written out one literal at a time because Tailwind scans
 * source text, so a computed `bg-${color}-400` compiles to nothing,
 * silently.
 */
export const AREA_DOT_CLASS: Record<PaletteColor, string> = {
  slate: "bg-slate-400",
  blue: "bg-blue-400",
  green: "bg-emerald-400",
  amber: "bg-amber-400",
  red: "bg-red-400",
  violet: "bg-violet-400",
  cyan: "bg-cyan-400",
  pink: "bg-pink-400",
};

/**
 * An area with no colour picked, and any area we cannot resolve.
 */
export const AREA_DOT_FALLBACK = "bg-muted-foreground/50";

/**
 * The same palette as the hue half of a `Badge variant="tint"`, for tag
 * chips. Pass it as that badge's `className`, never on a bare span.
 *
 * A separate table rather than a suffix on `AREA_DOT_CLASS`, for the same
 * Tailwind reason: these are the literal strings the scanner has to find.
 *
 * ⚠️ Fill and border only. The label stays body text, which is the rule
 * `tint` states and gives a reason for: at chip size, coloured text on a
 * coloured ground is the pairing that fails contrast first. These used to
 * tint the text instead of the border, on a bare span, which is what made
 * the board's tags a third format of their own (quest #1638).
 */
export const TAG_CHIP_CLASS: Record<PaletteColor, string> = {
  slate: "border-slate-500/40 bg-slate-500/15",
  blue: "border-blue-500/40 bg-blue-500/15",
  green: "border-emerald-500/40 bg-emerald-500/15",
  amber: "border-amber-500/40 bg-amber-500/15",
  red: "border-red-500/40 bg-red-500/15",
  violet: "border-violet-500/40 bg-violet-500/15",
  cyan: "border-cyan-500/40 bg-cyan-500/15",
  pink: "border-pink-500/40 bg-pink-500/15",
};

/**
 * A tag the project has picked no colour for. Neutral rather than hidden:
 * the label still carries the word, it just does not claim a meaning the
 * owner has not assigned. Identical to the badge's own `neutral` tone.
 */
export const TAG_CHIP_FALLBACK = "border-border bg-muted text-muted-foreground";

export class AreaDotColor {
  protected readonly byName: Map<string, string>;

  constructor(areas: AreaResource[] | undefined) {
    this.byName = new Map(
      (areas ?? []).map((area) => [
        area.name,
        area.color ? AREA_DOT_CLASS[area.color] : AREA_DOT_FALLBACK,
      ]),
    );
  }

  /**
   * `quests.area` is a plain string joined by name rather than a foreign
   * key, so an area the project has since renamed resolves to nothing here.
   * That is a missing colour, never a missing quest.
   */
  dotClass(area: string): string {
    return this.byName.get(area) ?? AREA_DOT_FALLBACK;
  }
}
