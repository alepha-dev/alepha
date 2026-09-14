import { useI18n } from "alepha/react/i18n";
import { FunnelPlus } from "lucide-react";
import type { ComponentType } from "react";

import { Button } from "../core/Button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../core/DropdownMenu.tsx";

export interface DataTableFilterAddProps {
  /**
   * The filters not currently in the bar. ⚠️ Only the hidden ones: an item
   * already on screen would offer to add a second copy of itself.
   */
  items: DataTableFilterAddItem[];
  onAdd: (key: string) => void;
}

/**
 * The funnel-plus at the end of a filter bar: what a reader presses to bring
 * a filter they are not currently using into view.
 *
 * A funnel rather than a bare `+`, so it says WHAT it adds. A plus at the end
 * of a row of filters is the generic "add something" of every toolbar, and it
 * sat next to a remove button that had no icon of its own either; the two now
 * pair, funnel-plus against funnel-x.
 *
 * It exists because the bar now starts nearly empty. Showing every filter a
 * table supports spends the width of the bar on questions nobody has asked -
 * four boxes reading "Any status", "Any team", "Any role" say only that those
 * columns exist. So the bar opens with the search box alone and grows as the
 * reader asks for it.
 *
 * ⚠️ Renders NOTHING when there is nothing left to add, rather than a
 * disabled button. A button that cannot add is an affordance that has to be
 * tried before it can be understood, and the state it describes - every
 * filter already on screen - is fully visible without it.
 *
 * The caller owns which filters are shown; this only asks. It is also the
 * caller's job to open the new filter once it appears - see
 * `DataTableFilterBar`, which does both.
 */
export const DataTableFilterAdd = (props: DataTableFilterAddProps) => {
  const { tr } = useI18n();
  const label = tr("dataTable.addFilter", { default: "Add filter" });
  const groupLabel = tr("dataTable.filterBy", { default: "Filter by" });

  // Spelled out case by case rather than built from the type: the i18n check
  // finds a key by its literal call, and a key assembled at runtime would be
  // reported unused and fail the audit.
  const typeLabel = (type: DataTableFilterAddType): string => {
    switch (type) {
      case "text":
        return tr("dataTable.filterType.text", { default: "text" });
      case "list":
        return tr("dataTable.filterType.list", { default: "list" });
      case "date":
        return tr("dataTable.filterType.date", { default: "date" });
    }
  };

  if (props.items.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            // Minimal, and the SAME SIZE as the bar's other icon buttons -
            // the column picker, the filter menu, the refresh. Ghost rather
            // than outlined because an outlined 36px button beside a row of
            // outlined 36px controls read as an empty filter box, which is
            // the one thing it is not; but the footprint has to match the
            // other chrome in the bar or it reads as a different class of
            // control again, just in the other direction. `h-9 w-9` and a
            // `size-4` icon are exactly what `DataTable` gives its own
            // toolbar buttons.
            className="text-muted-foreground hover:text-foreground h-9 w-9 shrink-0 p-0"
            aria-label={label}
          />
        }
      >
        <FunnelPlus className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {/*
          A real `DropdownMenuGroup`, not a bare label above the items.
          `DropdownMenuLabel` renders Base UI's `Menu.GroupLabel`, which
          expects a `Menu.Group` around it - outside one it is a floating
          label with nothing to name, and it is the group that ties the
          heading to the items for a screen reader.
        */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>{groupLabel}</DropdownMenuLabel>
          {props.items.map((item) => {
            const Icon = item.icon;
            return (
              <DropdownMenuItem
                key={item.key}
                onClick={() => props.onAdd(item.key)}
              >
                {Icon && <Icon className="size-4" />}
                {item.label}
                {item.type && (
                  // `DropdownMenuShortcut` for its muted colour, its
                  // `ml-auto` and its highlight-follow on focus. Its
                  // `tracking-widest` is for a key chord and makes a word
                  // look spaced out, so it is put back; `pl-6` keeps the hint
                  // clear of the longest label.
                  <DropdownMenuShortcut className="pl-6 tracking-normal">
                    {typeLabel(item.type)}
                  </DropdownMenuShortcut>
                )}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export interface DataTableFilterAddItem {
  /**
   * Stable key the caller uses to identify the filter it is showing.
   */
  key: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;

  /**
   * What kind of control the filter is, drawn muted on the right of the item.
   *
   * It answers the question the reader has before choosing: "Email" could be
   * a box to type in or a list of addresses. Absent draws nothing.
   */
  type?: DataTableFilterAddType;
}

/**
 * The control shapes a filter bar carries: a free-text box, a list to pick
 * from, or a range of days on a calendar. A select taking several values is
 * still a `list`: whether it takes one or many is found out by opening it,
 * and another word in the menu was noise rather than help.
 */
export type DataTableFilterAddType = "text" | "list" | "date";
