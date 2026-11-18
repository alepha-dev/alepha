import type { BadgeTone } from "@alepha/ui";
import type { PaletteColor } from "@lore/core/schemas";

import type { AreaResource } from "../../../../api/schemas/areaResourceSchema.ts";

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
const AREA_DOT_FALLBACK = "bg-muted-foreground/50";

/**
 * A tag's chip tone: the colour the project picked for it, which names one
 * of `Badge`'s hue tones one for one, or `neutral` for a tag with none (the
 * label still carries the word, it just claims no colour the owner has not
 * assigned). Every tag chip is `<Badge variant="tint" tone={tagTone(...)}>`,
 * the one tinted chip of Alepha UI, never a palette of classes of its own
 * (quest #1638 was the third format that drifted).
 */
export const tagTone = (color: string | undefined): BadgeTone =>
  color && color in AREA_DOT_CLASS ? (color as PaletteColor) : "neutral";

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
