import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { useI18n } from "alepha/react/i18n";
import { Funnel, FunnelX, Share2 } from "lucide-react";

export interface AlephaTableFilterMenuProps {
  /**
   * How many filters currently narrow the list. Gates both items: neither
   * sharing nor clearing means anything with nothing set.
   *
   * It is deliberately NOT drawn on the trigger, unlike
   * {@link AlephaTableFilterDialog}'s. That dialog badges its trigger because
   * the filter bar is not on screen behind it; out here the bar IS the
   * indicator, holding the values themselves a few pixels to the left, so a
   * count beside it says the same thing twice and reads as a notification.
   */
  activeCount: number;
  onShare: () => void;
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
 * The same `Funnel` icon as {@link AlephaTableFilterDialog}, on purpose: one
 * affordance for filters, whatever the width. Not its badge, though - see
 * `activeCount` for why the count stops at the phone.
 */
export const AlephaTableFilterMenu = (props: AlephaTableFilterMenuProps) => {
  const { tr } = useI18n();
  const label = tr("alephaTable.filters", { default: "Filters" });
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
        <DropdownMenuItem disabled={idle} onClick={props.onShare}>
          <Share2 className="size-4" />
          {tr("alephaTable.shareFilters", { default: "Share filters" })}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={idle} onClick={props.onReset}>
          <FunnelX className="size-4" />
          {tr("alephaTable.resetFilters", { default: "Reset filters" })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
