import {
  type PlateTab,
  PlateTabBar,
} from "@alepha/ui/components/plate-layout/plate-tab-bar";
import { cn } from "@alepha/ui/lib/utils";
import type { ReactNode } from "react";

export interface PlateLayoutProps {
  /**
   * The band above the tabs: what this page IS. A title, the two or three
   * facts true on every tab, and the actions that act on the whole thing.
   *
   * A slot rather than props, because there is no shape common to a release's
   * tag and progress bar, a project's reporting period and an enrolled app's
   * address. What the layout owns is the band, not its contents.
   */
  plate?: ReactNode;
  tabs: PlateTab[];
  /**
   * The active tab's `key`. For a router-driven bar, the current route name.
   */
  active: string;
  onSelect?: (key: string) => void;
  /**
   * Marks the tab bar for tests. See {@link PlateTabBarProps.testId}.
   */
  tabsTestId?: string;
  /**
   * Whether the layout wraps the body in its own scroll region. Default
   * `true`, which is what keeps the plate still while the content moves.
   *
   * Pass `false` for a tab that owns its scrolling - one with a sticky
   * toolbar of its own, or a reading measure it has to centre. Nesting a
   * scroll region inside a scroll region gives it two.
   */
  scroll?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * A full-width plate over a tab strip, and a body that scrolls under both.
 *
 * Lifted from Lore's Release view, which is the shape it names: a page whose
 * identity is several facts wide, with sections that are big enough to be
 * their own view. Distinct from the resource view's left panel and segmented
 * tabs, which is for a page whose identity is one line and whose sections are
 * fields.
 *
 * Deliberately NOT a router: a tab may be a route (`href` on the tab) or a
 * panel swap (`onSelect`), and the layout does not care which. That is what
 * lets Reports and an app's page - which are real nested routes - and the
 * Release view - which is one route with a `?tab=` - share it.
 */
export const PlateLayout = (props: PlateLayoutProps) => (
  <div
    className={cn(
      "flex min-h-0 w-full flex-1 flex-col overflow-hidden",
      props.className,
    )}
  >
    <div className="bg-card/30 border-border shrink-0 border-b">
      {props.plate}
      <PlateTabBar
        tabs={props.tabs}
        active={props.active}
        onSelect={props.onSelect}
        testId={props.tabsTestId}
      />
    </div>

    {props.scroll === false ? (
      props.children
    ) : (
      <div className="min-h-0 flex-1 overflow-y-auto">{props.children}</div>
    )}
  </div>
);
