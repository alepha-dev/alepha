import * as React from "react";

void React;

import { Link } from "alepha/react/router";
import { Lock } from "lucide-react";

import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../core/DropdownMenu.tsx";
import { type NavItem, renderNavIcon } from "./appShellNav.tsx";

export interface AppShellNavDropdownItemsProps {
  items: NavItem[];
}

/**
 * The children of a collapsed nav group, as dropdown entries.
 *
 * Recurses through nested groups via `DropdownMenuSub` —
 * `AppShellSidebarNavItem` recurses into itself for depth-2 groups in the
 * expanded tree, and without the matching recursion here a nested group would
 * be dead again one level down, which is the very bug the collapsed branch of
 * `AppShellSidebarNavItem.tsx` exists to fix.
 *
 * Badges are carried inline. `SidebarMenuBadge` is
 * `group-data-[collapsible=icon]:hidden`, so a collapsed sidebar drops every
 * count — and the count is usually why you opened the group.
 */
export const AppShellNavDropdownItems = (
  props: AppShellNavDropdownItemsProps,
) => {
  return (
    <>
      {props.items.map((child, ci) => {
        const badge = child.badge != null && child.badge !== false && (
          <span className="text-muted-foreground ml-auto pl-2 text-xs tabular-nums">
            {child.badge}
          </span>
        );

        if (child.children && child.children.length > 0) {
          return (
            <DropdownMenuSub key={child.href ?? ci}>
              <DropdownMenuSubTrigger>
                {renderNavIcon(child.icon, "size-4")}
                <span>{child.label}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <AppShellNavDropdownItems items={child.children} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        }

        if (child.disabled) {
          return (
            <DropdownMenuItem key={child.href ?? ci} disabled>
              {renderNavIcon(child.icon, "size-4")}
              <span>{child.label}</span>
              <Lock className="ml-auto size-3.5 opacity-70" />
            </DropdownMenuItem>
          );
        }

        return (
          <DropdownMenuItem
            key={child.href ?? ci}
            render={<Link href={child.href ?? "#"} />}
          >
            {renderNavIcon(child.icon, "size-4")}
            <span>{child.label}</span>
            {badge}
          </DropdownMenuItem>
        );
      })}
    </>
  );
};
