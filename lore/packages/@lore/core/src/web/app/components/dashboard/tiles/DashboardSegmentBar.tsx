import { cn } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";

import type { DashboardCardValue } from "../../../../../api/schemas/dashboardCardValueSchema.ts";
import type { I18n } from "../../../services/I18n.ts";
import { DASHBOARD_FILL_CLASS } from "./dashboardTileState.ts";

export interface DashboardSegmentBarProps {
  segments: NonNullable<DashboardCardValue["segments"]>;
  /**
   * Draw a legend under the bar: a breakdown by area or tag needs one, a
   * done / in progress / todo bar does not, since the footer says it.
   */
  legend?: boolean;
}

/**
 * The segment labels the locale names. Anything else is the reader's own
 * word (an area, a tag) and is shown as written.
 */
const NAMED = new Set(["done", "inProgress", "todo", "shelved", "held"]);

/**
 * A stacked bar, each part as wide as its share of the total.
 *
 * A segment with no state takes the palette in order, so a breakdown of five
 * areas is five distinguishable hues from the chart tokens rather than five
 * greys.
 */
const DashboardSegmentBar = (props: DashboardSegmentBarProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const total = props.segments.reduce((sum, it) => sum + it.value, 0);
  const palette = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4"];

  const name = (label: string) =>
    NAMED.has(label) ? tr(`dashboard.segment.${label}` as never) : label;
  const fill = (index: number) => {
    const state = props.segments[index]!.state;
    return state
      ? DASHBOARD_FILL_CLASS[state]
      : palette[index % palette.length]!;
  };

  return (
    <div className="flex w-full flex-col gap-1.5" data-testid="tile-segments">
      <div className="bg-muted flex h-2 w-full overflow-hidden rounded-full">
        {total > 0 &&
          props.segments.map((segment, index) => (
            <span
              key={segment.label}
              data-testid="tile-segment"
              className={cn("h-full", fill(index))}
              style={{ width: `${(segment.value / total) * 100}%` }}
              title={`${name(segment.label)}: ${l(segment.value)}`}
            />
          ))}
      </div>
      {props.legend && (
        <div className="text-muted-foreground flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px]">
          {props.segments.map((segment, index) => (
            <span
              key={segment.label}
              className="inline-flex items-center gap-1"
            >
              <span className={cn("size-1.5 rounded-full", fill(index))} />
              <span className="max-w-24 truncate">{name(segment.label)}</span>
              <span className="tabular-nums">{l(segment.value)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default DashboardSegmentBar;
