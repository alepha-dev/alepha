import * as React from "react";

import { cn } from "../core/utils.ts";

void React;

import { Link, NestedView } from "alepha/react/router";
import { useSidebarState } from "alepha/react/ui";
import type { ReactNode } from "react";
import { Fragment, useState } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../core/Breadcrumb.tsx";
import { Separator } from "../core/Separator.tsx";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarProvider,
} from "../core/Sidebar.tsx";
import { Toaster } from "../core/Toaster.tsx";
import { TooltipProvider } from "../core/Tooltip.tsx";
import { DialogProvider } from "../core/useDialog.tsx";
import {
  ActionErrorToaster,
  type ActionErrorToasterProps,
} from "./ActionErrorToaster.tsx";
import { findOpenPath, type NavGroup, samePath } from "./appShellNav.tsx";
import { AppShellSidebarNavItem } from "./AppShellSidebarNavItem.tsx";
import { AppShellStatefulSidebarTrigger } from "./AppShellStatefulSidebarTrigger.tsx";
import {
  NavigationProgress,
  type NavigationProgressOptions,
} from "./NavigationProgress.tsx";
import { SidebarNavAutoClose } from "./SidebarNavAutoClose.tsx";

/**
 * Re-exported: the bar moved to its own module so it can be mounted at an
 * application root, but the option type is part of {@link AppShellProps}
 * and was importable from here first.
 */
export type { NavigationProgressOptions };

export interface AppShellProps {
  /**
   * Branding shown at the top of the sidebar.
   */
  brand?: ReactNode;
  /**
   * Sidebar navigation groups.
   */
  nav?: NavGroup[];
  /**
   * Keep at most ONE nav group open at a time. Defaults to `true`.
   *
   * Opening a group closes the one that was open beside it, the way an
   * accordion does. Exclusivity is per level, so a nested group opens inside
   * its parent rather than replacing it, and the open branch always runs from
   * the root to the deepest open group.
   *
   * On means the sidebar owns the open state, so `NavItem.defaultOpen` seeds
   * the branch rather than opening a group of its own: the first item asking
   * for it wins, and only when nothing is active. Pass `false` for the older
   * behaviour, where every group keeps its own state and any number can be
   * open at once.
   *
   * ⚠️ Nothing changes in the icon rail. Collapsed to icons a group is a
   * dropdown, and one dropdown at a time is already all a menu can do.
   */
  navAccordion?: boolean;
  /**
   * Slide a nav group open and shut instead of swapping it in. Defaults to
   * `true`.
   *
   * `false` is a snap, not a shorter animation: an app that wants a different
   * duration or curve should style
   * `[data-slot=sidebar-menu-item] [data-state]` rather than turn this off.
   *
   * ⚠️ Honours `prefers-reduced-motion` on its own, so this is not the switch
   * for accessibility. It exists for a shell embedded somewhere that owns its
   * own motion, and for a test that would rather not wait 200ms.
   */
  navAnimate?: boolean;
  /**
   * Which glyph a collapsible nav group carries. Defaults to `"caret"`.
   *
   * - `"caret"` - a chevron that turns a quarter clockwise when the group
   *   opens. One glyph, and the rotation is the state.
   * - `"plusMinus"` - a plus when shut, a minus when open. Two glyphs that
   *   name the two states outright, where a caret only points and leaves the
   *   reader to learn which direction means open.
   *
   * ⚠️ Nothing in the icon rail. Collapsed, a group is a dropdown that opens
   * to the RIGHT, so its chevron is a direction rather than a state and there
   * is no minus that could answer it.
   */
  navToggleIcon?: "caret" | "plusMinus";
  /**
   * Content rendered at the bottom of the sidebar (user menu, etc.).
   */
  sidebarFooter?: ReactNode;
  /**
   * Breadcrumb crumbs (last one is rendered as the current page).
   */
  breadcrumbs?: { label: ReactNode; href?: string }[];
  /**
   * Top-bar right-side content (search, theme toggle, user menu).
   */
  topbarActions?: ReactNode;
  /**
   * Layout variant.
   * - `sidebar` (default): sidebar and page sit flush side-by-side.
   * - `inset`: sidebar uses the global background; the page is a rounded card with margin.
   * - `floating`: the page uses the global background; the sidebar is a rounded card with margin.
   */
  variant?: "sidebar" | "floating" | "inset";
  /**
   * When `variant="inset"`, lift the header out of the floating card so it
   * sits on the sidebar background — only the main page becomes the card.
   * Has no effect on other variants.
   */
  headerOutside?: boolean;
  /**
   * Top loading bar shown during route transitions.
   * `true` (default) enables it with default styling, `false` disables it,
   * or pass an options object to customize.
   */
  progress?: boolean | NavigationProgressOptions;
  /**
   * Page content. Defaults to `<NestedView />` (renders the active route).
   */
  children?: ReactNode;
  /**
   * Surface failed `useAction` / `useQuery` calls as a toast (via the
   * `react:action:error` event). `true` (default) enables it, `false`
   * disables it, or pass an options object to configure
   * (see {@link ActionErrorToasterProps}). Ignored when `embedded` (the
   * parent layout owns the toaster).
   */
  actionErrorToaster?: boolean | ActionErrorToasterProps;
  /**
   * When `true`, the shell assumes it is mounted inside an outer provider tree
   * and skips its own `<DialogProvider>` and `<Toaster />` wrappers. Use this
   * when a parent layout already provides them.
   */
  embedded?: boolean;
  /**
   * When `true`, the shell fills its parent container instead of the viewport
   * (`min-h-svh`). Use when a parent layout owns the height (e.g. when a
   * sticky footer sits below the shell).
   */
  fill?: boolean;
  /**
   * Extra classes for the scrolling `<main>` element.
   *
   * Exists so an app can paint its own page surface (Lore stamps a dot
   * texture there) without every other consumer of the shell inheriting it.
   * Layout classes are applied after this, so a caller cannot break the
   * flex/overflow contract described above.
   */
  mainClassName?: string;
}

/**
 * Standard SaaS layout: collapsible sidebar + topbar with breadcrumbs.
 * Built on shadcn `<Sidebar>` + `<Breadcrumb>`.
 */
export const AppShell = (props: AppShellProps) => {
  const { collapsed, setCollapsed } = useSidebarState();
  const nav = props.nav ?? [];

  // The accordion's one open branch. Held here because exclusivity is a
  // question about SIBLINGS, and no nav item can see its own.
  const navAccordion = props.navAccordion ?? true;
  const navAnimate = props.navAnimate ?? true;
  const navToggleIcon = props.navToggleIcon ?? "caret";
  const wantedOpenPath = findOpenPath(nav);
  const [openPath, setOpenPath] = useState(wantedOpenPath);
  // Follow the active page. Set during render of THIS component, which is the
  // supported way to react to changed input without a wasted frame; the same
  // pattern a nav item uses for its own state when the accordion is off.
  // Only ever opens: `findOpenPath` returns an empty path when nothing is
  // active and nothing asked for `defaultOpen`, and adopting that would slam
  // the branch shut on every navigation to a top-level page.
  const [lastWanted, setLastWanted] = useState(wantedOpenPath);
  if (!samePath(wantedOpenPath, lastWanted)) {
    setLastWanted(wantedOpenPath);
    if (wantedOpenPath.length > 0) setOpenPath(wantedOpenPath);
  }
  const variant = props.variant ?? "sidebar";
  const progress = props.progress ?? true;
  const headerOutside = !!props.headerOutside && variant === "inset";

  const headerNode = (
    <header
      className={
        headerOutside
          ? "bg-sidebar flex h-14 shrink-0 items-center gap-2 px-4"
          : "bg-background flex h-14 shrink-0 items-center gap-2 border-b px-4"
      }
    >
      {/* This bar is one non-wrapping flex line, and on a Lore project page it
          carries the trigger, a separator, the breadcrumbs, a split button,
          the search button and four header icons: about 470px of content in
          373px at phone width. Nothing here used to be marked as the one that
          must survive, so the overflow fell off the RIGHT end and took the
          theme, colour-mode and account controls with it — off-screen, with no
          horizontal scroll to reach them and no menu they collapse into.

          So everything on the row is `shrink-0` with exactly one exception:
          the breadcrumbs, which are the one thing repeated in the page below
          and can therefore afford to give way. They truncate while there is
          still something to read, and below `sm` they are dropped outright
          rather than left as an unreadable sliver. */}
      <div className="flex shrink-0 items-center">
        <AppShellStatefulSidebarTrigger />
        <Separator orientation="vertical" className="mx-2" />
      </div>
      {props.breadcrumbs && props.breadcrumbs.length > 0 && (
        <Breadcrumb className="min-w-0 overflow-hidden max-sm:hidden">
          {/* `flex-nowrap`: the list wraps by default, and a second line in an
              `h-14` bar is drawn outside it. */}
          <BreadcrumbList className="flex-nowrap">
            {props.breadcrumbs.map((crumb, i) => {
              const last = i === props.breadcrumbs!.length - 1;
              return (
                <Fragment key={i}>
                  <BreadcrumbItem className="min-w-0">
                    {last || !crumb.href ? (
                      <BreadcrumbPage className="truncate">
                        {crumb.label}
                      </BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink
                        className="truncate"
                        render={<Link href={crumb.href} />}
                      >
                        {crumb.label}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {!last && <BreadcrumbSeparator className="shrink-0" />}
                </Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      )}
      <div className="flex-1" />
      {/* Wrapped rather than spread straight into the header: the actions have
          to be one `shrink-0` unit, and they keep the `gap-2` the header was
          giving them. */}
      <div className="flex shrink-0 items-center gap-2">
        {props.topbarActions}
      </div>
    </header>
  );

  const mainNode = (
    // Layout contract for `fill: true` pages:
    //   parent (`h-svh`) → SidebarProvider (`h-full`) → SidebarInset → main
    //   - main is `flex flex-col min-h-0 flex-1` so its children can
    //     claim the leftover height via `flex-1 min-h-0`.
    //   - main itself is `overflow-hidden` (not `overflow-auto`) so the
    //     table's inner `overflow-auto` is the actual scroll surface —
    //     header stays sticky, body scrolls, no page-level scrollbar.
    //   - For non-fill pages there's no height bound, so this collapses
    //     to "scroll whatever overflows" without further config.
    //
    // `relative` is load-bearing in BOTH branches, and it is the whole of
    // #1849: an `overflow` declared on a STATIC element does not clip an
    // absolutely positioned descendant whose containing block resolves above
    // it. Base UI gives every named form control a 1×1 hidden `<input>`
    // styled `position: absolute` with no offsets, so on a page whose fields
    // live inside an inner scroller each of those inputs escaped this `main`,
    // resolved against the positioned `SidebarInset` and pinned the document
    // open at its own static offset — a page that scrolled 1271px into empty
    // background beneath a shell that had not moved. Positioning `main` makes
    // its overflow bound real, whatever a page renders inside it.
    <main
      className={cn(
        props.mainClassName,
        "relative",
        props.fill
          ? "flex min-h-0 flex-1 flex-col overflow-hidden"
          : "flex-1 overflow-auto",
      )}
    >
      {props.children ?? <NestedView />}
    </main>
  );
  const renderBody = () => (
    <>
      {progress !== false && (
        <NavigationProgress {...(progress === true ? {} : progress)} />
      )}
      <SidebarProvider
        open={!collapsed}
        onOpenChange={(o: boolean) => setCollapsed(!o)}
        // `fill` = a parent owns the height (e.g. a full-width banner above
        // the shell). The desktop sidebar is `fixed inset-y-0 h-svh` (pinned
        // to the VIEWPORT), so it would overlap whatever sits above the
        // shell — re-anchor it to this wrapper instead (absolute within the
        // now-relative provider, height from the wrapper). The arbitrary
        // selectors out-specify the base `.fixed`/`.h-svh` utilities.
        className={
          props.fill
            ? "relative h-full min-h-0 [&_[data-slot=sidebar-container]]:absolute [&_[data-slot=sidebar-container]]:h-auto"
            : undefined
        }
      >
        <Sidebar collapsible="icon" variant={variant}>
          {/* Wraps the WHOLE sidebar, brand slot and footer included, because
              the links that leave this sheet are not only the nav items - the
              project switcher lives in `brand` and each app puts its own
              links in `sidebarFooter`. */}
          <SidebarNavAutoClose>
            <SidebarHeader>{props.brand}</SidebarHeader>
            <SidebarContent>
              {nav.map((group, gi) => (
                <SidebarGroup key={gi}>
                  {group.label && (
                    <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                  )}
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map((item, ii) => (
                        <AppShellSidebarNavItem
                          key={item.href ?? `${gi}-${ii}`}
                          item={item}
                          path={[gi, ii]}
                          accordion={
                            navAccordion ? { openPath, setOpenPath } : undefined
                          }
                          animate={navAnimate}
                          toggleIcon={navToggleIcon}
                        />
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}
            </SidebarContent>
            {props.sidebarFooter && (
              <SidebarFooter>{props.sidebarFooter}</SidebarFooter>
            )}
          </SidebarNavAutoClose>
        </Sidebar>
        {headerOutside ? (
          <div className="bg-sidebar flex flex-1 flex-col">
            {headerNode}
            <div className="bg-background m-2 mt-0 flex flex-1 flex-col overflow-hidden rounded-xl border shadow-sm">
              {mainNode}
            </div>
          </div>
        ) : (
          <SidebarInset
            className={
              variant === "inset"
                ? "border md:peer-data-[variant=inset]:overflow-hidden"
                : undefined
            }
          >
            {headerNode}
            {mainNode}
          </SidebarInset>
        )}
      </SidebarProvider>
    </>
  );

  if (props.embedded) {
    return renderBody();
  }

  const errorToaster = props.actionErrorToaster ?? true;

  return (
    <DialogProvider>
      <TooltipProvider>
        {renderBody()}
        <Toaster />
        {errorToaster !== false && (
          <ActionErrorToaster
            {...(typeof errorToaster === "object" ? errorToaster : {})}
          />
        )}
      </TooltipProvider>
    </DialogProvider>
  );
};
