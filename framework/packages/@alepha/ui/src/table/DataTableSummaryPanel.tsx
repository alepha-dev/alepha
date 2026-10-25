import { ChevronRight } from "lucide-react";
import { type ReactNode, useId } from "react";

import { Skeleton } from "../core/Skeleton.tsx";
import { cn } from "../core/utils.ts";
import { DataTableSummaryCard } from "./DataTableSummaryCard.tsx";
import type { DataTableStatCard } from "./dataTableTypes.ts";

export interface DataTableSummaryPanelProps {
  /**
   * The panel's name, on its toggle.
   */
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The cards, or `undefined` while the first fetch is in flight, which
   * draws placeholder tiles.
   */
  cards: DataTableStatCard[] | undefined;
  /**
   * A fetch is in flight. The cards already on screen stay while it runs.
   */
  loading: boolean;
  /**
   * The caller's node, under the cards. The table passes `undefined` for a
   * node that draws nothing.
   */
  content?: ReactNode;
  /**
   * Where the panel sits in the table's frame, and the table's
   * `chromeClassName`, merged after the panel's own classes.
   */
  className?: string;
}

/**
 * The collapsible band at the top of the table: a disclosure button, then the
 * stat cards and the caller's content.
 *
 * `bg-muted` with the `--bevel` fold, like the filter bar under it: it is the
 * table's chrome, and now the top edge of the block, so it is the band that
 * carries the fold deciding whether the block sits ON the page. The tiles
 * inside take the page's own background, sunk into it the way the filter
 * inputs are.
 */
export const DataTableSummaryPanel = (props: DataTableSummaryPanelProps) => {
  const bodyId = useId();

  return (
    <section
      data-slot="data-table-summary"
      aria-label={props.title}
      className={cn(
        "bg-muted rounded-md rounded-b-none border shadow-[inset_0_1px_0_0_var(--bevel)]",
        props.className,
      )}
    >
      <button
        type="button"
        aria-expanded={props.open}
        aria-controls={props.open ? bodyId : undefined}
        onClick={() => props.onOpenChange(!props.open)}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex h-8 w-full items-center gap-1.5 rounded-t-md px-3 text-left text-xs font-medium outline-none focus-visible:ring-[3px]"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            props.open && "rotate-90",
          )}
        />
        <span className="truncate">{props.title}</span>
      </button>
      {props.open && (
        <div
          id={bodyId}
          aria-busy={props.loading}
          className="flex flex-col gap-2 px-2 pb-2"
        >
          {props.cards === undefined ? (
            <div
              aria-hidden
              className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2"
            >
              {PLACEHOLDER_TILES.map((key) => (
                <Skeleton key={key} className="h-[74px] rounded-md" />
              ))}
            </div>
          ) : (
            props.cards.length > 0 && (
              // `auto-fit`, not a breakpoint count: the table can sit in a
              // pane of any width, and it is the table's width that decides
              // how many tiles fit a row, not the viewport's. `9rem` keeps two
              // abreast on a phone.
              <dl className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
                {props.cards.map((card) => (
                  <DataTableSummaryCard key={card.label} card={card} />
                ))}
              </dl>
            )
          )}
          {props.content !== undefined && (
            <div className="min-w-0">{props.content}</div>
          )}
        </div>
      )}
    </section>
  );
};

/**
 * How many placeholder tiles stand in for cards not fetched yet. Four, the
 * row the pages this was written for draw.
 */
const PLACEHOLDER_TILES = ["a", "b", "c", "d"];
