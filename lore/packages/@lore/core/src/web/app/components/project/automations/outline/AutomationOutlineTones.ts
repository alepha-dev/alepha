/**
 * The outline's four tones (#Q3847, folio F1524): each section has a
 * coloured rail, a tinted band and a solid label, and its rows an icon
 * tile. When is primary, Only if warning, Then (do) success, Otherwise neutral.
 */
export class AutomationOutlineTones {
  public static readonly TONES = {
    when: {
      rail: "border-s-primary",
      band: "bg-primary/12",
      label: "bg-primary text-primary-foreground",
      tile: "bg-primary/15 text-primary-text",
    },
    if: {
      rail: "border-s-warning",
      band: "bg-warning/25",
      label: "bg-warning text-warning-foreground",
      tile: "bg-warning/30 text-warning-text",
    },
    do: {
      rail: "border-s-success",
      band: "bg-success/12",
      label: "bg-success text-success-foreground",
      tile: "bg-success/15 text-success-text",
    },
    else: {
      rail: "border-s-foreground/45",
      band: "bg-foreground/8",
      label: "bg-foreground/70 text-background",
      tile: "bg-foreground/10 text-foreground",
    },
  } as const;

  /**
   * The page behind the blocks: the foreground mixed into the background,
   * so each block reads as a card on it.
   */
  public static readonly CANVAS =
    "bg-[color-mix(in_oklab,var(--foreground)_7%,var(--background))]";
}

export type AutomationOutlineTone = keyof typeof AutomationOutlineTones.TONES;
