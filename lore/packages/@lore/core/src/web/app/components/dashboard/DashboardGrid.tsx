import { cn } from "@alepha/ui";
import { useState } from "react";

import type { DashboardCardResource } from "../../../../api/schemas/dashboardCardResourceSchema.ts";
import type { DashboardCardValue } from "../../../../api/schemas/dashboardCardValueSchema.ts";
import type { DashboardMetricDescriptor } from "../../../../api/schemas/DashboardMetricCatalog.ts";
import DashboardCard from "./DashboardCard.tsx";
import DashboardGridBackdropCell from "./DashboardGridBackdropCell.tsx";

export interface DashboardGridProps {
  cards: DashboardCardResource[];
  values?: DashboardCardValue[];
  /**
   * The catalogue, by metric key, for each card's label and icon.
   */
  metrics: Map<string, DashboardMetricDescriptor>;
  /**
   * The project this board belongs to, on a project board. Drives the scope
   * chip rule - see `DashboardCard.boardProjectId`.
   */
  boardProjectId?: number;
  /**
   * Whether the viewer may curate the board. `false` renders no add tile, no
   * card menu and no drag handle. Defaults to true, so home is untouched.
   */
  canEdit?: boolean;
  onReorder: (ids: number[]) => void;
  onAdd: () => void;
  onChangeScope: (card: DashboardCardResource) => void;
  /**
   * Resize a card from its menu (#Q2651). Absent, the menu offers no size.
   */
  onResize?: (
    card: DashboardCardResource,
    size: { size: number; height: number },
  ) => void;
  onDuplicate: (card: DashboardCardResource) => void;
  onRemove: (card: DashboardCardResource) => void;
  /**
   * True while a card write runs: the menu's writes are held until it lands,
   * since `run()` would drop a second one in silence (#E59 rule 10).
   */
  busy?: boolean;
}

/**
 * The grid, and the drag that reorders it.
 *
 * ## Columns
 *
 * `repeat(auto-fill, minmax(clamp(216px, 15cqw, 300px), 1fr))` over a `168px`
 * row. `216px` and the row height are the mockup's own track sizes, and
 * `auto-fill` keeps the tile identical at every width while letting the
 * number per row fall out of the space — the same design on a viewport that
 * can be a phone. At the mockup's own width it still lays out four.
 *
 * The `clamp` is what a fixed `216px` minimum got wrong at the top end: the
 * track never grew, so a 2100px window packed seven 235px tiles instead of
 * six comfortable ones, and a 2560px one packed nine. `15cqw` is read
 * against `main`'s inline size (it carries `@container`), not the viewport,
 * so the rail's 320px does not count towards it and a collapsed rail widens
 * the tiles rather than adding one. Below roughly 1440px the clamp floors at
 * the mockup's `216px` and nothing about the old layout changes; above it
 * the tiles widen instead of multiplying, up to `300px`.
 *
 * ## Height and sections (#Q2651)
 *
 * A card spans `height` rows as well as `size` columns, and consecutive
 * cards carrying the same `section` render under one heading, each run its
 * own grid. At phone width the grid is one column and every tile one row:
 * the spans are applied from `sm` up only (see `DashboardCard`).
 *
 * ## The backdrop
 *
 * Behind each run of tiles sits a layer of slots laid out on the very same
 * template (columns, row height, gap), each ruled through its gutters and
 * crop-marked at its corners (`DashboardGridBackdropCell`), so the board
 * reads as a sheet ruled for its tiles at every width. The layer is
 * absolutely positioned, so it takes no track of its own, and the last run's
 * grid grows to the bottom of the page so the rules carry on below the last
 * tile. It clips with a 6px margin, half the gap, so the rules of the first
 * row and column survive; its cell count only has to outnumber what the box
 * can show.
 *
 * ## Drag
 *
 * Native HTML5 drag: the list is flat, `@dnd-kit/sortable` is not a
 * dependency here, and the mockup was drawn with these events. The order is
 * applied optimistically and persisted through the card CRUD — the server
 * takes the complete id list, so what is sent is exactly what is on screen.
 */
const DashboardGrid = (props: DashboardGridProps) => {
  const [armed, setArmed] = useState<number | undefined>();
  const [dragging, setDragging] = useState<number | undefined>();
  const [over, setOver] = useState<number | undefined>();

  const resolvedValue = (cardId: number) =>
    props.values?.find((value) => value.cardId === cardId);

  const canEdit = props.canEdit ?? true;

  const move = (from: number | undefined, to: number) => {
    setDragging(undefined);
    setOver(undefined);
    setArmed(undefined);
    if (from === undefined || from === to) return;

    const ids = props.cards.map((card) => card.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved!);
    props.onReorder(ids);
  };

  /**
   * Runs of consecutive cards sharing a section, each with the index its
   * first card has in the whole list, so a drag still moves by global index.
   */
  const runs: Array<{
    section?: string;
    start: number;
    cards: DashboardCardResource[];
  }> = [];
  props.cards.forEach((card, index) => {
    const last = runs[runs.length - 1];
    if (last && last.section === card.section) {
      last.cards.push(card);
    } else {
      runs.push({ section: card.section, start: index, cards: [card] });
    }
  });

  return (
    <div className="flex flex-1 flex-col gap-5">
      {runs.map((run, runIndex) => (
        <section
          key={`${run.start}-${run.section ?? ""}`}
          className={cn(
            "flex flex-col gap-2.5",
            runIndex === runs.length - 1 && "flex-1",
          )}
          data-testid="dashboard-section"
        >
          {run.section && (
            <h2 className="text-muted-foreground text-[12px] font-medium tracking-[0.05em] uppercase">
              {run.section}
            </h2>
          )}
          <div
            className={cn(
              GRID_TEMPLATE,
              "relative items-stretch",
              runIndex === runs.length - 1 && "flex-1",
            )}
          >
            <div
              aria-hidden
              data-testid="dashboard-backdrop"
              className={cn(
                GRID_TEMPLATE,
                // The slots rule their own top and left only; the
                // `after:` rule closes the sheet on the right, down the
                // gutter line past the last column.
                "after:border-border/25 pointer-events-none absolute inset-0 overflow-clip [overflow-clip-margin:6px] after:absolute after:-top-1.5 after:-right-1.5 after:bottom-0 after:border-r",
              )}
            >
              {Array.from({ length: BACKDROP_CELLS }, (_, cell) => (
                <DashboardGridBackdropCell key={cell} />
              ))}
            </div>
            {run.cards.map((card, offset) => {
              const index = run.start + offset;
              const descriptor = props.metrics.get(card.metric);
              return (
                <DashboardCard
                  key={card.id}
                  card={card}
                  value={resolvedValue(card.id)}
                  // A card whose metric this build does not know still
                  // renders: the resolver marks it failed, and the tile says
                  // so rather than vanishing from a layout the reader
                  // arranged.
                  labelKey={
                    descriptor?.cardLabelKey ??
                    descriptor?.labelKey ??
                    "dashboard.metric.unknown"
                  }
                  icon={descriptor?.icon ?? "circle-dashed"}
                  presentation={descriptor?.presentation}
                  chartStyle={descriptor?.chartStyle}
                  boardProjectId={props.boardProjectId}
                  canEdit={canEdit}
                  armed={armed === index}
                  dragging={dragging === index}
                  over={over === index && dragging !== index}
                  onArm={() => setArmed(index)}
                  onDisarm={() => setArmed(undefined)}
                  onDragStart={() => setDragging(index)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (over !== index) setOver(index);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    move(dragging, index);
                  }}
                  onDragEnd={() => {
                    setDragging(undefined);
                    setOver(undefined);
                    setArmed(undefined);
                  }}
                  onChangeScope={() => props.onChangeScope(card)}
                  onResize={
                    props.onResize
                      ? (size) => props.onResize?.(card, size)
                      : undefined
                  }
                  onDuplicate={() => props.onDuplicate(card)}
                  onRemove={() => props.onRemove(card)}
                  busy={props.busy}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};

/**
 * The tiles' track sizes, shared by the grid and its backdrop so the two can
 * never disagree. See "Columns" above.
 */
const GRID_TEMPLATE =
  "grid auto-rows-[168px] grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(clamp(216px,15cqw,300px),1fr))]";

/**
 * Enough slots to cover a 2560px-wide, 1440px-tall board: eleven columns at
 * the 216px floor by nine rows, with room to spare.
 */
const BACKDROP_CELLS = 120;

export default DashboardGrid;
