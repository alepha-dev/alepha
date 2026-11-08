import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./utils.ts";

export interface PaneRailProps {
  /**
   * The edge of the layout the collapsed pane sits on. It picks the icon and
   * puts the border on the side that faces the content the pane was beside.
   */
  side: "left" | "right";
  /**
   * The expand button's accessible name and tooltip, e.g. "Show history".
   */
  label: string;
  onExpand: () => void;
  /**
   * The pane's own icon, at the top of the strip. Given one, the rail names
   * WHAT it reopens, and the open-panel arrow moves to the strip's foot so
   * the strip still says it opens something. Without one the arrow is the
   * only mark, at the top.
   */
  icon?: ReactNode;
  /**
   * Shown under the top icon: a count badge, say. Not separately
   * actionable, since the whole strip is the button.
   */
  children?: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * What a collapsible pane leaves behind once it is closed: a 36px strip that
 * is, all of it, the button that brings the pane back.
 *
 * A pane closed with a click has to say how to reopen it. Collapsing to
 * nothing strands the reader: the only routes back left are a keyboard
 * shortcut and a menu that does not advertise itself, for a pane they just
 * closed with a click.
 *
 * The whole strip is the hit area, hover included, rather than a small
 * button at its top: the strip has no other use, and a 28px target inside a
 * full-height column reads as broken when a click below it does nothing.
 *
 * It moved from Lore into the kit with #Q2265 and became one full-height
 * button with #Q3206, so the admin Parameters History panel, Lore's folio
 * tree and inspector, and Lore's Quest Log (`icon` plus a count as
 * `children`) share one strip and cannot drift apart.
 *
 * ⚠️ Render it only where the pane would otherwise be a COLUMN. Where a
 * layout stacks its panes or turns one into an overlay, a strip frees no
 * width and only changes the default layout.
 */
export const PaneRail = (props: PaneRailProps) => {
  const Arrow = props.side === "left" ? PanelLeftOpen : PanelRightOpen;

  return (
    <button
      type="button"
      onClick={props.onExpand}
      aria-label={props.label}
      title={props.label}
      data-testid={props["data-testid"]}
      className={cn(
        "border-border text-muted-foreground hover:text-foreground hover:bg-hover focus-visible:ring-ring/50 flex w-9 flex-none cursor-pointer flex-col items-center gap-2 pt-3 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-inset",
        props.side === "left" ? "border-r" : "border-l",
        props.className,
      )}
    >
      {props.icon ?? <Arrow className="size-4 shrink-0" />}
      {props.children}
      {props.icon && <Arrow className="mt-auto mb-3 size-3.5 shrink-0" />}
    </button>
  );
};
