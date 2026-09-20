import { useI18n } from "alepha/react/i18n";
import { Funnel, FunnelX, Share2 } from "lucide-react";

import { Button } from "../core/Button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../core/DropdownMenu.tsx";

export interface DataTableFilterMenuProps {
  /**
   * How many filters currently narrow the list. Gates Share: sharing means
   * nothing with nothing set.
   *
   * It is deliberately NOT drawn on the trigger, unlike
   * {@link DataTableFilterDialog}'s. That dialog badges its trigger because
   * the filter bar is not on screen behind it; out here the bar IS the
   * indicator, holding the values themselves a few pixels to the left, so a
   * count beside it says the same thing twice and reads as a notification.
   */
  activeCount: number;
  /**
   * Whether Reset would change anything. Not `activeCount` alone: a bar the
   * reader rearranged (a default filter removed, an optional one added) is
   * something to reset while no value is set.
   */
  canReset: boolean;
  /**
   * Share the current filters as a link, when the table is linkable at all.
   * `undefined` drops the item, leaving the menu with Reset alone.
   */
  onShare?: () => void;
  onReset: () => void;
}

/**
 * The filter menu in the toolbar, on anything wider than a phone.
 *
 * It replaces the bare "Reset filters" icon button, for two reasons that
 * arrived together:
 *
 * - **Share needed somewhere to live.** A filtered table is a view worth
 *   sending to someone, and the address bar cannot carry it: the filters are
 *   never written back to the URL (see `fromQuery`, and Lore incident #156).
 *   So the link has to be something the reader asks for, which means an item
 *   in a menu rather than a bar that writes as you type.
 * - **Clear belongs beside it.** The two are one decision - this view, kept
 *   or dropped - and a menu is where a reader looks for both.
 *
 * The same `Funnel` icon as {@link DataTableFilterDialog}, on purpose: one
 * affordance for filters, whatever the width. Not its badge, though - see
 * `activeCount` for why the count stops at the phone.
 *
 * ## A table that cannot be linked gets the menu anyway
 *
 * Without `onShare` this is a menu of one item, which the toolbar used to
 * refuse: it drew a bare `FunnelX` button instead, on the grounds that a
 * menu costs a click to reach a button already on the bar. What that traded
 * away is the reason for the click. The bare button spends most of its life
 * disabled - Reset does nothing until a value is set or the bar is moved -
 * and a greyed icon with no words on it does not say whether it resets
 * filters, clears a search or empties the table. Behind the `Funnel` the
 * same state reads as "Reset filters", greyed, which explains itself.
 */
export const DataTableFilterMenu = (props: DataTableFilterMenuProps) => {
  const { tr } = useI18n();
  const label = tr("dataTable.filters", { default: "Filters" });
  const idle = props.activeCount === 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-9 w-9 p-0"
            aria-label={label}
          />
        }
      >
        <Funnel className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {props.onShare && (
          <DropdownMenuItem disabled={idle} onClick={props.onShare}>
            <Share2 className="size-4" />
            {tr("dataTable.shareFilters", { default: "Share filters" })}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={!props.canReset} onClick={props.onReset}>
          <FunnelX className="size-4" />
          {tr("dataTable.resetFilters", { default: "Reset filters" })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
