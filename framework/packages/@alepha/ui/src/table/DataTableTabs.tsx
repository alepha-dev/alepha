import { Link } from "alepha/react/router";
import type { ComponentType, KeyboardEvent, ReactNode } from "react";

import { inlineArrowKey } from "../core/inlineArrowKey.ts";
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
 * the active tab is an outlined tile of the bar below it, flaring into the band at its
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
 *
 * It claims `role="tablist"`, so it keeps that role's keyboard contract: one
 * tab stop (the active tab, or the first when none is), and the arrow keys,
 * Home and End move the focus between tabs. Activation stays manual: Enter or
 * Space on the focused tab, as a click would, so moving through the band
 * never navigates or reloads a table on its own.
 */
export const DataTableTabs = (props: DataTableTabsProps) => {
  const stop = Math.max(
    0,
    props.tabs.findIndex((tab) => tab.active),
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tabs = [
      ...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'),
    ];
    const current = tabs.indexOf(e.target as HTMLElement);
    if (current === -1) return;
    const key = inlineArrowKey(e);
    const next =
      key === "ArrowRight"
        ? (current + 1) % tabs.length
        : key === "ArrowLeft"
          ? (current - 1 + tabs.length) % tabs.length
          : key === "Home"
            ? 0
            : key === "End"
              ? tabs.length - 1
              : -1;
    if (next === -1) return;
    e.preventDefault();
    tabs[next]!.focus();
  };

  return (
    // oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- a roving tab stop: the tabs take the focus, the tablist only hears their arrow keys
    <div
      role="tablist"
      onKeyDown={onKeyDown}
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
          "relative flex h-9 shrink-0 items-center gap-2 rounded-t-[0.625rem] border border-b-0 px-4 text-sm font-medium transition-colors duration-150",
          tab.active
            ? // The tile is outlined on its top and sides, and its bottom
              // stays open onto the bar, whose own side borders carry the
              // outline on. The ears: two squares outside the tile's bottom
              // corners, each filled but for a quarter circle, so the tile's
              // sides curve out into the band. The circle's rim is a 1px ring
              // of the border colour, so the outline follows the curve from
              // the tile's side down to the band's bottom line. An inset is
              // measured from the padding box, inside the border, so each ear
              // is 1px wider and taller and reaches over the tile's border
              // column: its ring lands on that border, and its fill hides the
              // straight side below the curve. Swapped under rtl, where the
              // start is the right.
              "bg-muted text-foreground border-border before:absolute before:start-[calc(-0.625rem_-_1px)] before:bottom-0 before:size-[calc(0.625rem_+_1px)] before:bg-[image:radial-gradient(circle_at_0_0,transparent_0.625rem,var(--border)_calc(0.625rem_+_0.5px),var(--border)_calc(0.625rem_+_1px),var(--muted)_calc(0.625rem_+_1.5px))] before:content-[''] after:absolute after:end-[calc(-0.625rem_-_1px)] after:bottom-0 after:size-[calc(0.625rem_+_1px)] after:bg-[image:radial-gradient(circle_at_100%_0,transparent_0.625rem,var(--border)_calc(0.625rem_+_0.5px),var(--border)_calc(0.625rem_+_1px),var(--muted)_calc(0.625rem_+_1.5px))] after:content-[''] rtl:before:bg-[image:radial-gradient(circle_at_100%_0,transparent_0.625rem,var(--border)_calc(0.625rem_+_0.5px),var(--border)_calc(0.625rem_+_1px),var(--muted)_calc(0.625rem_+_1.5px))] rtl:after:bg-[image:radial-gradient(circle_at_0_0,transparent_0.625rem,var(--border)_calc(0.625rem_+_0.5px),var(--border)_calc(0.625rem_+_1px),var(--muted)_calc(0.625rem_+_1.5px))]"
            : "text-muted-foreground hover:text-foreground border-transparent hover:bg-[color-mix(in_oklab,var(--muted),transparent_40%)]",
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
            tabIndex={index === stop ? 0 : -1}
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
            tabIndex={index === stop ? 0 : -1}
            className={className}
            onClick={tab.onSelect}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
};
