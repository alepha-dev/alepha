import * as React from "react";

void React;

import { ChevronDown } from "lucide-react";

import { Button } from "../core/Button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../core/DropdownMenu.tsx";
import { cn } from "../core/utils.ts";
import type { DetailTab } from "./DetailLayout.tsx";

export interface DetailLayoutTabMenuProps {
  tabs: DetailTab[];
  tab: string;
  onTabChange: (value: string) => void;
  className?: string;
}

/**
 * The tab selector of a {@link DetailLayout} on a phone: one button naming
 * the open tab, and a menu listing every tab.
 *
 * Below `md` the segmented strip does not fit beside the actions. An epic
 * page at 393px left it 220px, so it showed `Over` of `Overview` and hid
 * four tabs behind a scroll iOS draws no scrollbar for. A menu holds any
 * number of tabs at full width, whatever the caller puts in `actions`.
 */
export const DetailLayoutTabMenu = (props: DetailLayoutTabMenuProps) => {
  const current =
    props.tabs.find((entry) => entry.value === props.tab) ?? props.tabs[0];
  const CurrentIcon = current?.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outlined"
            size="lg"
            data-slot="detail-tab-menu"
            className={cn("max-w-full min-w-0 justify-start", props.className)}
          />
        }
      >
        {CurrentIcon ? <CurrentIcon className="size-4" /> : null}
        <span className="min-w-0 truncate">{current?.label}</span>
        {current?.count !== undefined && current.count !== null ? (
          <span className="text-muted-foreground tabular-nums">
            {current.count}
          </span>
        ) : null}
        <ChevronDown className="text-muted-foreground size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={props.tab}
          onValueChange={(value: string) => props.onTabChange(value)}
        >
          {props.tabs.map((entry) => {
            const Icon = entry.icon;
            return (
              // A single choice, so picking one closes the menu.
              <DropdownMenuRadioItem
                key={entry.value}
                value={entry.value}
                closeOnClick
                className="py-1.5"
              >
                {Icon ? <Icon className="size-4" /> : null}
                {entry.label}
                {entry.count !== undefined && entry.count !== null ? (
                  <span className="text-muted-foreground tabular-nums">
                    {entry.count}
                  </span>
                ) : null}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
