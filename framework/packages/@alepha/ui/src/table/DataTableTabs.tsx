import { Link } from "alepha/react/router";
import type { ComponentType, ReactNode } from "react";

import { cn } from "../core/utils.ts";

/**
 * One tab of a table's tab band: a view of the same page, such as the users
 * and the profiles of a team, or the open and the closed tickets.
 */
export interface DataTableTab {
  /** Unique among the tabs. */
  key: string;
  label: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  /** Drawn as a pill after the label. Omitted, or `null`, draws none. */
  count?: number | null;
  /** Whether this is the tab on screen. The caller decides it. */
  active?: boolean;
  /** A route: the tab is a link, for tabs that are pages of their own. */
  href?: string;
  /** Called on a click, for tabs that switch state inside one page. */
  onSelect?: () => void;
}

export interface DataTableTabsProps {
  tabs: DataTableTab[];
  className?: string;
}

/**
 * The band of tabs that opens a table's frame, drawn like a browser's tabs:
 * the active tab is a tile of the bar below it, flaring into the band at its
 * two bottom corners, so the tab and the bar read as one surface. A resting
 * tab is plain text, lit as a tile on hover, with a short divider between two
 * resting neighbours.
 *
 * The band scrolls sideways when its tabs outrun it, and never vertically:
 * `overflow-x-auto` alone computes `overflow-y` as `auto` too, so anything
 * reaching past the band's bottom edge drew a vertical scrollbar wherever
 * scrollbars are always shown. Its bottom line is therefore an inset shadow,
 * not a border a tab would have to overlap: the tabs paint over it, so the
 * active tile covers it and joins the bar, and everywhere else it stays the
 * line between the band and what follows.
 */
export const DataTableTabs = (props: DataTableTabsProps) => (
  <div
    role="tablist"
    data-slot="data-table-tabs"
    className={cn(
      "bg-background flex items-end overflow-x-auto overflow-y-hidden rounded-md rounded-b-none border border-b-0 px-3 pt-1.5 shadow-[inset_0_-1px_0_0_var(--border)]",
      props.className,
    )}
  >
    {props.tabs.map((tab, index) => {
      const Icon = tab.icon;
      // A divider on the start edge of a resting tab that follows another
      // resting tab, hidden while either of the two is hovered.
      const divided =
        !tab.active && index > 0 && !props.tabs[index - 1]!.active;
      const className = cn(
        "relative flex h-9 shrink-0 items-center gap-2 rounded-t-[0.625rem] px-4 text-sm font-medium transition-colors duration-150",
        tab.active
          ? // The ears: two squares outside the tile's bottom corners, each
            // filled but for a quarter circle, so the tile's sides curve out
            // into the band. Swapped under rtl, where the start is the right.
            "bg-muted text-foreground before:absolute before:start-[-0.625rem] before:bottom-0 before:size-[0.625rem] before:bg-[image:radial-gradient(circle_at_0_0,transparent_0.625rem,var(--muted)_calc(0.625rem_+_0.5px))] before:content-[''] after:absolute after:end-[-0.625rem] after:bottom-0 after:size-[0.625rem] after:bg-[image:radial-gradient(circle_at_100%_0,transparent_0.625rem,var(--muted)_calc(0.625rem_+_0.5px))] after:content-[''] rtl:before:bg-[image:radial-gradient(circle_at_100%_0,transparent_0.625rem,var(--muted)_calc(0.625rem_+_0.5px))] rtl:after:bg-[image:radial-gradient(circle_at_0_0,transparent_0.625rem,var(--muted)_calc(0.625rem_+_0.5px))]"
          : "text-muted-foreground hover:text-foreground hover:bg-[color-mix(in_oklab,var(--muted),transparent_40%)]",
        divided &&
          "before:bg-border before:absolute before:start-0 before:top-[30%] before:h-[40%] before:w-px before:content-[''] hover:before:opacity-0 [[role=tab]:hover+&]:before:opacity-0",
      );
      const content = (
        <>
          {Icon && <Icon className="size-4" />}
          {tab.label}
          {tab.count != null && (
            <span
              className={cn(
                "rounded-full px-1.5 text-xs tabular-nums",
                tab.active
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {tab.count}
            </span>
          )}
        </>
      );
      return tab.href ? (
        <Link
          key={tab.key}
          href={tab.href}
          role="tab"
          aria-selected={Boolean(tab.active)}
          className={className}
          onClick={tab.onSelect}
        >
          {content}
        </Link>
      ) : (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={Boolean(tab.active)}
          className={className}
          onClick={tab.onSelect}
        >
          {content}
        </button>
      );
    })}
  </div>
);
