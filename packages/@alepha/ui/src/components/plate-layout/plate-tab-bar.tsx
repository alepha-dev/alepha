import type { IconComponent } from "@alepha/ui/components/control-base/icon-hint";
import { cn } from "@alepha/ui/lib/utils";
import { Link } from "alepha/react/router";

export interface PlateTab {
  /**
   * Identifies the tab. Compared against {@link PlateTabBarProps.active}, and
   * handed back to {@link PlateTabBarProps.onSelect}. For a router-driven bar
   * this is the route name.
   */
  key: string;
  label: string;
  icon?: IconComponent;
  /**
   * A trailing count, in a pill of its own rather than folded into the label.
   * The pill's colour follows the tab's state - `text-foreground` active,
   * `text-muted-foreground` not - and a count written into the label would
   * carry one fixed class that is wrong on one of the two. Same reason
   * `Segmented` has a `count` prop.
   *
   * Show it only once its collection has resolved: `undefined` renders the
   * bare label rather than a confident "0".
   */
  count?: number;
  /**
   * Makes this tab a NAVIGATION rather than a state change. Present, the tab
   * is a router `Link` and `onSelect` is not called; absent, it is a button.
   *
   * Both shapes exist because both are real: a tab that swaps a panel inside
   * one route is state, and a tab that is its own route has to be a link -
   * middle-click, copy-link and the back button all depend on it.
   */
  href?: string;
}

export interface PlateTabBarProps {
  tabs: PlateTab[];
  active: string;
  /**
   * Called for a tab with no `href`. A router-driven bar passes nothing.
   */
  onSelect?: (key: string) => void;
  /**
   * Marks the bar for tests. Worth setting: tab labels are ordinary words
   * ("Overview", "Settings") that a page-wide `getByRole` finds in the tab
   * BODIES too, and "Settings" is also a project-level nav entry.
   */
  testId?: string;
  /**
   * Whether to rule off the top edge. Default `true`.
   *
   * The line separates the tabs from the plate above them, so it is only
   * right when there IS one. `PlateLayout` derives this from its own `plate`
   * slot; a bar with no plate above it would otherwise draw a stray line
   * immediately under the container's top edge, which is what a caller
   * omitting the plate for the first time discovered (feedback #2095).
   */
  divided?: boolean;
}

/**
 * Underlined tabs along the bottom edge of a {@link PlateLayout}'s plate.
 *
 * Underlines rather than `Segmented`, which sits inside a toolbar as a
 * control. This bar IS the bottom edge of a full-width band, and a pill group
 * floating on that edge reads as a widget dropped onto the header rather than
 * as the header's own last row.
 */
export const PlateTabBar = (props: PlateTabBarProps) => {
  // A bar of links is a NAVIGATION, not a tablist, and its items are links
  // rather than tabs. `role="tab"` on an anchor overrides the implicit link
  // role, which takes it out of `getByRole("link")` and tells a screen reader
  // it swaps a panel when it actually leaves the page. `aria-current="page"`
  // is what marks the current one in a set of navigation links.
  const navigates = props.tabs.every((tab) => tab.href !== undefined);

  return (
    <div
      data-testid={props.testId}
      className={cn(
        "border-border/60 flex gap-5 px-6",
        props.divided !== false && "border-t",
      )}
      role={navigates ? "navigation" : "tablist"}
    >
      {props.tabs.map((tab) => {
        const active = tab.key === props.active;
        const className = cn(
          "-mb-px inline-flex h-[42px] items-center gap-[7px] border-b-2 text-[13.5px] font-medium transition-colors",
          active
            ? "border-primary text-foreground"
            : "text-muted-foreground hover:text-foreground border-transparent",
        );
        const body = (
          <>
            {tab.icon && <tab.icon className="size-[14px]" aria-hidden />}
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  "bg-foreground/10 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px] font-mono text-[10.5px]",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {tab.count}
              </span>
            )}
          </>
        );

        return tab.href !== undefined ? (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={className}
          >
            {body}
          </Link>
        ) : (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => props.onSelect?.(tab.key)}
            className={className}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
};
