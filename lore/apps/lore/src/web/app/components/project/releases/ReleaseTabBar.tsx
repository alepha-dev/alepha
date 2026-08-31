import { cn } from "@alepha/ui/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface ReleaseTab<T extends string> {
  value: T;
  label: string;
  icon: LucideIcon;
  /**
   * A trailing count, in a pill of its own rather than folded into the
   * label. The pill's colour follows the tab's state - `text-foreground`
   * active, `text-muted-foreground` not - and a count written into the label
   * would carry one fixed class that is wrong on one of the two. The same
   * reason `Segmented` has a `count` prop.
   */
  count?: number;
}

export interface ReleaseTabBarProps<T extends string> {
  tabs: Array<ReleaseTab<T>>;
  value: T;
  onChange: (next: T) => void;
}

/**
 * The release view's tab bar: underlined tabs along the bottom edge of the
 * plate, flush with its left padding.
 *
 * Underlines rather than `@alepha/ui`'s `Segmented`, which every other detail
 * page in Lore uses. `Segmented` is a control that sits inside a toolbar; this
 * bar IS the bottom edge of a full-width band, and a pill group floating on
 * that edge would read as a widget dropped onto the header rather than the
 * header's own last row. Same reason `AppLayout` underlines its four.
 */
const ReleaseTabBar = <T extends string>(props: ReleaseTabBarProps<T>) => (
  <div
    // Named, because "Overview" and "Contents" are words a page-wide
    // `getByRole` will find in the tab bodies too.
    data-testid="release-tabs"
    className="border-border/60 flex gap-5 border-t px-6"
    role="tablist"
  >
    {props.tabs.map((tab) => {
      const active = tab.value === props.value;
      return (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={active}
          onClick={() => props.onChange(tab.value)}
          className={cn(
            "-mb-px inline-flex h-[42px] items-center gap-[7px] border-b-2 text-[13.5px] font-medium transition-colors",
            active
              ? "border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
        >
          <tab.icon className="size-[14px]" aria-hidden />
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
        </button>
      );
    })}
  </div>
);

export default ReleaseTabBar;
