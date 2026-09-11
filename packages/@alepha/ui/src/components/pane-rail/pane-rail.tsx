import { cn } from "@alepha/ui/lib/utils";
import { PanelLeftOpen, PanelRightOpen } from "lucide-react";

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
  className?: string;
}

/**
 * What a collapsible pane leaves behind once it is closed: a 36px strip with
 * the one button that brings it back.
 *
 * A pane closed with a click has to say how to reopen it. Collapsing to
 * nothing strands the reader: the only routes back left are a keyboard
 * shortcut and a menu that does not advertise itself, for a pane they just
 * closed with a click.
 *
 * It moved from Lore into the kit with #Q2265, so the admin Parameters
 * History panel and Lore's folio tree and inspector share one strip. Lore's
 * Quest Log rail is deliberately not built on it: there the whole rail is
 * the button and it carries a count badge, which makes it a different
 * control rather than a variant of this one.
 *
 * ⚠️ Render it only where the pane would otherwise be a COLUMN. Where a
 * layout stacks its panes or turns one into an overlay, a strip frees no
 * width and only changes the default layout.
 */
export const PaneRail = (props: PaneRailProps) => {
  const Icon = props.side === "left" ? PanelLeftOpen : PanelRightOpen;

  return (
    <div
      className={cn(
        "border-border flex w-9 flex-none flex-col items-center pt-1.5",
        props.side === "left" ? "border-r" : "border-l",
        props.className,
      )}
    >
      <button
        type="button"
        onClick={props.onExpand}
        aria-label={props.label}
        title={props.label}
        className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-7 items-center justify-center rounded-md transition-colors"
      >
        <Icon className="size-4" />
      </button>
    </div>
  );
};
