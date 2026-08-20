import type { AreaResource } from "@/api/schemas/areaResourceSchema.ts";

type AreaColor = NonNullable<AreaResource["color"]>;

/**
 * The palette token stored on `areas.color`, resolved to a class.
 *
 * The questline is the first surface in Lore to render this column at all:
 * it has been stored and picked in settings since 2026-08-19 and shown
 * nowhere. Written out one literal at a time because Tailwind scans source
 * text, so a computed `bg-${color}-400` compiles to nothing, silently.
 */
export const AREA_DOT_CLASS: Record<AreaColor, string> = {
  slate: "bg-slate-400",
  blue: "bg-blue-400",
  green: "bg-emerald-400",
  amber: "bg-amber-400",
  red: "bg-red-400",
  violet: "bg-violet-400",
  cyan: "bg-cyan-400",
  pink: "bg-pink-400",
};

/** An area with no colour picked, and any area we cannot resolve. */
export const AREA_DOT_FALLBACK = "bg-muted-foreground/50";

export class QuestlineAreaColor {
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
