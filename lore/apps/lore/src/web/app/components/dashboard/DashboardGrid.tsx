import { useState } from "react";

import type { DashboardCardResource } from "@/api/schemas/dashboardCardResourceSchema.ts";
import type { DashboardCardValue } from "@/api/schemas/dashboardCardValueSchema.ts";
import type { DashboardMetricDescriptor } from "@/api/services/DashboardMetricCatalog.ts";

import DashboardAddTile from "./DashboardAddTile.tsx";
import DashboardCard from "./DashboardCard.tsx";

export interface DashboardGridProps {
  cards: DashboardCardResource[];
  values?: DashboardCardValue[];
  /**
   * The catalogue, by metric key, for each card's label and icon.
   */
  metrics: Map<string, DashboardMetricDescriptor>;
  onReorder: (ids: number[]) => void;
  onAdd: () => void;
  onChangeScope: (card: DashboardCardResource) => void;
  onDuplicate: (card: DashboardCardResource) => void;
  onRemove: (card: DashboardCardResource) => void;
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

  return (
    <div className="grid auto-rows-[168px] grid-cols-[repeat(auto-fill,minmax(clamp(216px,15cqw,300px),1fr))] items-stretch gap-3">
      {props.cards.map((card, index) => {
        const descriptor = props.metrics.get(card.metric);
        return (
          <DashboardCard
            key={card.id}
            card={card}
            value={resolvedValue(card.id)}
            // A card whose metric this build does not know still renders: the
            // resolver marks it failed, and the tile says so rather than
            // vanishing from a layout the reader arranged.
            labelKey={
              descriptor?.cardLabelKey ??
              descriptor?.labelKey ??
              "dashboard.metric.unknown"
            }
            icon={descriptor?.icon ?? "circle-dashed"}
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
            onDuplicate={() => props.onDuplicate(card)}
            onRemove={() => props.onRemove(card)}
          />
        );
      })}
      <DashboardAddTile onClick={props.onAdd} />
    </div>
  );
};

export default DashboardGrid;
