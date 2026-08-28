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
 * The same palette as a filled chip, for tag labels on a board card.
 *
 * A separate table rather than a suffix on `AREA_DOT_CLASS`, for the same
 * Tailwind reason: these are the literal strings the scanner has to find.
 * Border and text are tinted together so a chip reads as a colour at a
 * glance without shouting over the card's title.
 */
export const TAG_CHIP_CLASS: Record<PaletteColor, string> = {
  slate: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  blue: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  red: "bg-red-500/15 text-red-700 dark:text-red-300",
  violet: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  cyan: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  pink: "bg-pink-500/15 text-pink-700 dark:text-pink-300",
};

/**
 * A tag the project has picked no colour for. Neutral rather than hidden:
 * the label still carries the word, it just does not claim a meaning the
 * owner has not assigned.
 */
export const TAG_CHIP_FALLBACK = "bg-muted text-muted-foreground";

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
