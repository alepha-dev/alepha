import type { ReactNode } from "react";

import { cn } from "../core/utils.ts";
import { PlateFolderTabs } from "./PlateFolderTabs.tsx";
import { type PlateTab, PlateTabBar } from "./PlateTabBar.tsx";

export interface PlateLayoutProps {
  /**
   * The band above the tabs: what this page IS. A title, the two or three
   * facts true on every tab, and the actions that act on the whole thing.
   *
   * A slot rather than props, because there is no shape common to a release's
   * tag and progress bar, a project's reporting period and an enrolled app's
   * address. What the layout owns is the band, not its contents.
   *
   * Optional, and genuinely so since feedback #2095: a page whose plate would
   * only reprint what the breadcrumb leaf already says is better without one.
   * Omitting it also drops the tab bar's top rule, which exists to separate
   * the tabs from the plate and has nothing to separate them from otherwise.
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
   * Small actions at the end of the tab band, on the tabs' line: what
   * applies to the page whichever tab is open, such as an export or an
   * import: small minimal buttons (`size="sm"`), and the page's main
   * action last, as a small primary button.
   */
  tabsActions?: ReactNode;
  /**
   * How the tabs are drawn. `folder`, the default, is a band of tiles, the
   * active one opening into the body below it, like a browser's tabs;
   * `underline` is a plain bottom row with an underline under the active
   * tab.
   *
   * @default "folder"
   */
  tabsVariant?: "underline" | "folder";
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
    <div
      data-slot="plate-band"
      className={cn(
        // Solid `bg-card`, not a `/30` tint: a tint over the page is the
        // page's black in dark mode. In light it is the same white.
        "bg-card border-border shrink-0",
        // Folder tabs end on their own ruled strip (below), so only the
        // underline variant takes the band's bottom border.
        props.tabsVariant === "underline" && "border-b",
      )}
    >
      {props.plate}
      {props.tabsVariant !== "underline" ? (
        // The actions sit beside the strip, never in it: the strip is a
        // `tablist`, which holds tabs only. They carry the band's bottom
        // line on, so the band reads as one.
        <>
          <div className="flex items-stretch">
            <PlateFolderTabs
              testId={props.tabsTestId}
              className="min-w-0 flex-1 rounded-none border-x-0 border-t-0 bg-transparent px-4"
              tabs={props.tabs.map((tab) => ({
                key: tab.key,
                label: tab.label,
                icon: tab.icon,
                count: tab.count,
                href: tab.href,
                prefetch: tab.prefetch,
                active: tab.key === props.active,
                onSelect:
                  tab.href === undefined
                    ? () => props.onSelect?.(tab.key)
                    : undefined,
              }))}
            />
            {props.tabsActions ? (
              <div
                data-slot="plate-tabs-actions"
                className="flex shrink-0 items-center gap-1.5 px-3 pt-1.5 shadow-[inset_0_-1px_0_0_var(--border)]"
              >
                {props.tabsActions}
              </div>
            ) : null}
          </div>
          {/*
            A thin strip in the active tile's fill, ruled at its foot: the
            tile opens into it with no seam, and the body below is content,
            on `bg-card` (the surface rules in `styles.css`). It replaced a
            body filled grey to match the tile, which made every tab a grey
            page.
          */}
          <div
            aria-hidden
            data-slot="plate-tabs-strip"
            className="bg-muted h-2 border-b"
          />
        </>
      ) : (
        <div className="flex items-center">
          <div className="min-w-0 flex-1">
            <PlateTabBar
              tabs={props.tabs}
              active={props.active}
              onSelect={props.onSelect}
              testId={props.tabsTestId}
              divided={props.plate !== undefined}
            />
          </div>
          {props.tabsActions ? (
            <div
              data-slot="plate-tabs-actions"
              className="flex shrink-0 items-center gap-1.5 px-3"
            >
              {props.tabsActions}
            </div>
          ) : null}
        </div>
      )}
    </div>

    {props.scroll === false ? (
      // A body that owns its scroll is a page of content under a toolbar of
      // its own, on the content surface. Opaque, never transparent: without a
      // fill the shell behind it shows through.
      <div className="bg-card flex min-h-0 flex-1 flex-col">
        {props.children}
      </div>
    ) : (
      // Focusable, so a keyboard can scroll it when nothing inside it takes
      // focus (axe `scrollable-region-focusable`, WCAG 2.1.1).
      <div
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll region must take focus for the keyboard to scroll it (WCAG 2.1.1); the lint rule does not know scroll containers
        tabIndex={0}
        // Folder tabs end on their grey strip, so the body is content, on
        // `bg-card`. Underline tabs have no tile and keep the flat fill.
        className={cn(
          "focus-visible:ring-ring/50 min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-[3px] focus-visible:ring-inset",
          props.tabsVariant === "underline" ? "bg-muted" : "bg-card",
        )}
      >
        {props.children}
      </div>
    )}
  </div>
);
