import * as React from "react";

void React;

import { Link } from "alepha/react/router";
import { ChevronRight, Lock, Minus, Plus } from "lucide-react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../core/DropdownMenu.tsx";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../core/HoverCard.tsx";
import {
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "../core/Sidebar.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../core/Tooltip.tsx";
import {
  hasActiveDescendant,
  isOpenPathPrefix,
  type NavAccordion,
  type NavItem,
  renderNavIcon,
} from "./appShellNav.tsx";
import { AppShellNavCollapse } from "./AppShellNavCollapse.tsx";
import { AppShellNavDropdownItems } from "./AppShellNavDropdownItems.tsx";

export interface AppShellSidebarNavItemProps {
  item: NavItem;
  /**
   * This item's position in `nav`, used only by the accordion. See
   * {@link NavAccordion}.
   */
  path: number[];
  /**
   * Present when `navAccordion` is on, and then it OWNS the open state: the
   * local `useState` below is still declared (hooks cannot be conditional) but
   * nothing reads it.
   */
  accordion?: NavAccordion;
  /**
   * `navAnimate`, threaded down so a nested group animates like its parent.
   */
  animate: boolean;
  /**
   * `navToggleIcon`, threaded down for the same reason.
   */
  toggleIcon: "caret" | "plusMinus";
}

export const AppShellSidebarNavItem = (props: AppShellSidebarNavItemProps) => {
  const { item, path, accordion, animate, toggleIcon } = props;
  const { state, isMobile } = useSidebar();
  const children = item.children;
  const isGroup = !!children && children.length > 0;
  const hasActive = isGroup && hasActiveDescendant(item);
  const [localOpen, setLocalOpen] = useState(item.defaultOpen ?? hasActive);
  // Reveal a collapsed group when navigation makes one of its descendants
  // active — SPA nav, spotlight (⌘K), breadcrumb, or a deep-link that doesn't
  // remount this item (useState's initializer runs only at mount, so without
  // this the group stays stuck closed and the active page is hidden — petition
  // #4). Only OPENS; never auto-collapses, so a manual toggle is preserved.
  //
  // Accordion mode does the same job in `AppShell` instead, from the tree, and
  // skips this: the state lives there, and a child cannot write it mid-render.
  const [wasActive, setWasActive] = useState(hasActive);
  if (!accordion && hasActive !== wasActive) {
    setWasActive(hasActive);
    if (hasActive) setLocalOpen(true);
  }

  const open = accordion
    ? isOpenPathPrefix(path, accordion.openPath)
    : localOpen;

  // Closing means handing the branch back to this item's PARENT, not clearing
  // it: a nested group that closed itself by emptying the path would collapse
  // every ancestor along with it.
  const toggle = () => {
    if (accordion) {
      accordion.setOpenPath(open ? path.slice(0, -1) : path);
    } else {
      setLocalOpen((v) => !v);
    }
  };

  if (!isGroup) {
    // Disabled rows render with a muted, dashed-border treatment plus a
    // Lock affordance on the trailing edge. Clicks are swallowed. When a
    // `tooltip` is provided, the row opens a HoverCard dropdown on hover
    // so the explanation has space to breathe regardless of sidebar
    // state.
    if (item.disabled) {
      // Bypass SidebarMenuButton — it self-wraps in a Tooltip when given
      // a `tooltip` prop, which would swallow the HoverCard pointer
      // events. A plain styled <div> keeps cursor-not-allowed and lets
      // the row act as the HoverCard trigger.
      const row = (
        <div
          aria-disabled="true"
          className="border-muted-foreground/40 bg-muted/40 text-muted-foreground flex h-8 w-full items-center gap-2 rounded-md border border-dashed px-2 text-sm"
          style={{ cursor: "not-allowed" }}
        >
          {renderNavIcon(item.icon, "size-4 shrink-0")}
          <span className="flex-1 truncate text-left">{item.label}</span>
          <Lock className="size-3.5 shrink-0 opacity-70" />
        </div>
      );
      return (
        <SidebarMenuItem>
          {item.tooltip ? (
            <HoverCard>
              <HoverCardTrigger render={row} />
              <HoverCardContent side="right" align="start" className="text-sm">
                {item.tooltip}
              </HoverCardContent>
            </HoverCard>
          ) : (
            row
          )}
        </SidebarMenuItem>
      );
    }

    const link = (
      <SidebarMenuButton
        isActive={item.active}
        tooltip={typeof item.label === "string" ? item.label : undefined}
        render={<Link href={item.href ?? "#"} />}
      >
        {renderNavIcon(item.icon, "size-4")}
        <span>{item.label}</span>
      </SidebarMenuButton>
    );

    const row = item.tooltip ? (
      <Tooltip>
        <TooltipTrigger render={link} />
        <TooltipContent side="right">{item.tooltip}</TooltipContent>
      </Tooltip>
    ) : (
      link
    );

    return (
      <SidebarMenuItem>
        {row}
        {item.badge != null && item.badge !== false && (
          <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
        )}
      </SidebarMenuItem>
    );
  }

  // Collapsed to icons, the expanded branch below is a dead button: it still
  // flips `open`, but what `open` reveals is a `SidebarMenuSub`, which carries
  // `group-data-[collapsible=icon]:hidden`. The group has no `href` either, so
  // there is no fallback — every child is simply unreachable. A dropdown is the
  // standard answer, and it belongs here rather than in any one app because
  // this hits EVERY `NavItem` with children.
  //
  // Mobile is excluded: it uses the sheet, not icon mode, so the sub renders
  // normally there.
  if (isGroup && state === "collapsed" && !isMobile) {
    return (
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              // No `tooltip` here on purpose. `SidebarMenuButton` turns itself
              // into a `TooltipTrigger` when given one, and layering the
              // dropdown trigger on top makes hover and click fight over the
              // same element. The menu names itself with a label instead.
              //
              // `hasActive` joins `item.active` so the trigger still reads as
              // current when a descendant is — collapsed, it is the only clue
              // which group holds the open page.
              <SidebarMenuButton isActive={item.active || hasActive} />
            }
          >
            {renderNavIcon(item.icon, "size-4")}
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronRight className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="min-w-48">
            {/*
              The group wrapper is required, not cosmetic: `DropdownMenuLabel`
              is Base UI's `Menu.GroupLabel`, which reads `MenuGroupContext` and
              THROWS outside a `Menu.Group`. Nothing types this — the label
              compiles fine, and the whole app-shell crashes at the first click
              on the trigger, because the throw happens when the menu opens
              rather than when it mounts.
            */}
            <DropdownMenuGroup>
              <DropdownMenuLabel>{item.label}</DropdownMenuLabel>
              <AppShellNavDropdownItems items={children} />
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={toggle}
        isActive={item.active}
        tooltip={typeof item.label === "string" ? item.label : undefined}
      >
        {renderNavIcon(item.icon, "size-4")}
        <span className="flex-1 text-left">{item.label}</span>
        {/*
          Plus and minus are SWAPPED, never rotated: a plus turned 45° is a
          close button, which is a different promise. The caret is the one
          that turns, and it stays the default because it is what every app
          using this shell already had.
        */}
        {toggleIcon === "plusMinus" ? (
          open ? (
            <Minus className="size-4" />
          ) : (
            <Plus className="size-4" />
          )
        ) : (
          <ChevronRight
            className={`size-4 transition-transform ${open ? "rotate-90" : ""}`}
          />
        )}
      </SidebarMenuButton>
      <AppShellNavCollapse open={open} animate={animate}>
        <SidebarMenuSub>
          {children.map((child, ci) => (
            <SidebarMenuSubItem key={child.href ?? ci}>
              {child.children && child.children.length > 0 ? (
                <AppShellSidebarNavItem
                  item={child}
                  path={[...path, ci]}
                  accordion={accordion}
                  animate={animate}
                  toggleIcon={toggleIcon}
                />
              ) : (
                <SidebarMenuSubButton
                  isActive={child.active}
                  render={<Link href={child.href ?? "#"} />}
                >
                  {renderNavIcon(child.icon, "size-4")}
                  <span>{child.label}</span>
                </SidebarMenuSubButton>
              )}
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      </AppShellNavCollapse>
    </SidebarMenuItem>
  );
};
