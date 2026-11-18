import type { BadgeTone } from "../core/Badge.tsx";
import { cn } from "../core/utils.ts";
import type { DataTableStatCard } from "./dataTableTypes.ts";

export interface DataTableSummaryCardProps {
  card: DataTableStatCard;
  /**
   * The tile's `filter` holds now: drawn pressed.
   */
  active?: boolean;
  /**
   * Makes the tile a button (it has a `filter` and the table has filters).
   */
  onSelect?: () => void;
}

/**
 * One tile of the summary panel: the label, the figure, the hint.
 *
 * A `<div>` of `<dt>` and `<dd>`s, since the panel is a `<dl>`: a reader
 * that lists terms hears "Files, 1,204" rather than two loose strings.
 *
 * A tile with a `filter` is also a button: a transparent one laid over the
 * whole tile, so the `<dl>` keeps its terms and the click lands anywhere on
 * it. Pressed, it wears the foreground as its border, the way a selected
 * segment stands out from its row.
 */
export const DataTableSummaryCard = (props: DataTableSummaryCardProps) => {
  const { card } = props;
  const Icon = card.icon;
  return (
    <div
      data-slot="data-table-stat"
      data-tone={card.tone}
      data-active={props.active || undefined}
      className={cn(
        "bg-background relative flex min-w-0 flex-col gap-1 rounded-md border px-3 py-2.5",
        card.tone && DATA_TABLE_STAT_TONE[card.tone],
        props.onSelect && "hover:border-foreground/40 transition-colors",
        props.active && "border-foreground ring-foreground ring-1",
      )}
    >
      {props.onSelect && (
        <button
          type="button"
          aria-pressed={props.active ?? false}
          aria-label={card.label}
          onClick={props.onSelect}
          className="focus-visible:ring-ring/50 absolute inset-0 rounded-md outline-none focus-visible:ring-[3px]"
        />
      )}
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
  slate: "border-slate-500/40 bg-linear-to-b from-slate-500/10 to-slate-500/10",
  blue: "border-blue-500/40 bg-linear-to-b from-blue-500/10 to-blue-500/10",
  green:
    "border-emerald-500/40 bg-linear-to-b from-emerald-500/10 to-emerald-500/10",
  amber: "border-amber-500/40 bg-linear-to-b from-amber-500/10 to-amber-500/10",
  red: "border-red-500/40 bg-linear-to-b from-red-500/10 to-red-500/10",
  violet:
    "border-violet-500/40 bg-linear-to-b from-violet-500/10 to-violet-500/10",
  cyan: "border-cyan-500/40 bg-linear-to-b from-cyan-500/10 to-cyan-500/10",
  pink: "border-pink-500/40 bg-linear-to-b from-pink-500/10 to-pink-500/10",
};
