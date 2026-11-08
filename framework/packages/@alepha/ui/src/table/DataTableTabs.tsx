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
 * The band of tabs that opens a table's frame. Its bottom border is the line
 * between it and the band below, which joins under it like the rows join the
 * toolbar.
 *
 * The band scrolls sideways when its tabs outrun it, and never vertically:
 * `overflow-x-auto` alone computes `overflow-y` as `auto` too, so anything a
 * tab pushed past the band's bottom edge (a negative margin overlapping the
 * border, say) drew a vertical scrollbar wherever scrollbars are always
 * shown. The tabs therefore sit inside the band, the active underline resting
 * on its bottom border rather than over it.
 */
export const DataTableTabs = (props: DataTableTabsProps) => (
  <div
    role="tablist"
    data-slot="data-table-tabs"
    className={cn(
      "bg-background flex items-end gap-1 overflow-x-auto overflow-y-hidden rounded-md rounded-b-none border px-2 pt-1",
      props.className,
    )}
  >
    {props.tabs.map((tab) => {
      const Icon = tab.icon;
      const className = cn(
        "flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        tab.active
          ? "border-primary text-primary"
          : "text-muted-foreground hover:text-foreground border-transparent",
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
