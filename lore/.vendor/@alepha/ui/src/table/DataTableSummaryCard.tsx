import type { BadgeTone } from "../core/Badge.tsx";
import { cn } from "../core/utils.ts";
import type { DataTableStatCard } from "./dataTableTypes.ts";

export interface DataTableSummaryCardProps {
  card: DataTableStatCard;
}

/**
 * One tile of the summary panel: the label, the figure, the hint.
 *
 * A `<div>` of `<dt>` and `<dd>`s, since the panel is a `<dl>`: a reader
 * that lists terms hears "Files, 1,204" rather than two loose strings.
 */
export const DataTableSummaryCard = (props: DataTableSummaryCardProps) => {
  const { card } = props;
  const Icon = card.icon;
  return (
    <div
      data-slot="data-table-stat"
      data-tone={card.tone}
      className={cn(
        "bg-background flex min-w-0 flex-col gap-1 rounded-md border px-3 py-2.5",
        card.tone && DATA_TABLE_STAT_TONE[card.tone],
      )}
    >
      <dt className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs font-medium">
        {Icon && <Icon aria-hidden className="size-3.5 shrink-0" />}
        <span className="truncate">{card.label}</span>
      </dt>
      <dd className="truncate text-xl leading-tight font-semibold tabular-nums">
        {card.value}
      </dd>
      {card.hint != null && card.hint !== false && (
        <dd className="text-muted-foreground truncate text-xs">{card.hint}</dd>
      )}
    </div>
  );
};

/**
 * The tones, on the hues a `tint` badge wears.
 *
 * The tint is a background IMAGE over the tile's opaque `bg-background`, not a
 * translucent background colour in its place: the panel behind the tiles is
 * the muted chrome, and a translucent fill would let it through, leaving a
 * toned tile greyer than the plain ones beside it instead of tinted.
 */
const DATA_TABLE_STAT_TONE: Record<BadgeTone, string> = {
  neutral: "",
  info: "border-blue-500/40 bg-linear-to-b from-blue-500/10 to-blue-500/10",
  success:
    "border-emerald-500/40 bg-linear-to-b from-emerald-500/10 to-emerald-500/10",
  warning:
    "border-amber-500/40 bg-linear-to-b from-amber-500/10 to-amber-500/10",
  danger: "border-red-500/40 bg-linear-to-b from-red-500/10 to-red-500/10",
};
