import { cn } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { useId, useState } from "react";

import type { I18n } from "../../services/I18n.ts";
import { momentumDelta, momentumGeometry } from "./homeMomentumPath.ts";

export interface HomeMomentumProps {
  /**
   * One count per day, oldest first, as `getHomeBoard` returns them.
   */
  counts: number[];
  /**
   * The day labels the counts are indexed by (`YYYY-MM-DD`), for the hover
   * readout.
   */
  days: string[];
  /**
   * The busiest day across EVERY row of the table, so the column compares
   * projects rather than each project against itself.
   */
  ceiling: number;
  /**
   * Accessible summary of the whole series, e.g. "312 events over 14 days".
   * The curve itself is decoration and carries no text.
   */
  label: string;
  /**
   * Whether the project has gone quiet (`HOME_INACTIVE_AFTER_DAYS`): the
   * curve and its text turn grey, so the table's eye goes to the live rows.
   */
  inactive?: boolean;
}

/**
 * The chart's height, in pixels and in viewBox units alike, so the vertical
 * axis is drawn 1:1 and only the horizontal one stretches with the cell.
 */
const HEIGHT = 32;

/**
 * Fourteen days of a project's recorded writes, as a smooth line over a
 * fading area, with the total and the week-on-week change under it.
 *
 * ## The scale is shared, and that is the whole point
 *
 * Every row is drawn against the busiest day in the table, not its own. A
 * per-row scale would give a project with two events a week the same
 * silhouette as one with two hundred, which reads as "equally busy" at a
 * glance and is the opposite of what the column is for. The cost is that
 * quiet projects are nearly flat, which is the true answer.
 *
 * ## One colour, from the theme
 *
 * The line, the fill and the dots are `--sidebar-primary`, the colour of the
 * sidebar's active-item bar: every theme gives it its own hue in both modes,
 * so light, dark and each theme need nothing of their own here. The SVG and
 * the dot read it through `currentColor`, which is also how an inactive row
 * turns the whole chart grey in one class. A rise wears the same colour as
 * the line; a fall and "flat" stay muted, since a quieter week is not a
 * fault.
 *
 * ## Hover reads a day in place
 *
 * The pointer snaps to the nearest day, a hairline and a dot mark it, and
 * the line under the chart shows that day's count and date instead of the
 * totals. In place rather than in a floating tooltip, which the table's own
 * scroll container would clip on the first rows.
 *
 * The line is stretched to the cell with `preserveAspectRatio="none"`, so it
 * carries `vector-effect: non-scaling-stroke` to stay 2px, and the dots are
 * HTML placed by percentage rather than SVG circles, which the stretch would
 * turn into ellipses.
 */
export const HomeMomentum = (props: HomeMomentumProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const gradientId = useId();
  const [hovered, setHovered] = useState<number | null>(null);

  const { points, line, area } = momentumGeometry(
    props.counts,
    props.ceiling,
    HEIGHT,
  );
  const total = props.counts.reduce((sum, count) => sum + count, 0);
  const delta = momentumDelta(props.counts);
  const last = points[points.length - 1];
  const marked = hovered === null ? undefined : points[hovered];

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || points.length === 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = Math.round(ratio * (points.length - 1));
    setHovered(Math.min(points.length - 1, Math.max(0, index)));
  };

  return (
    <div className="flex w-52 flex-col gap-1">
      <div
        className={cn(
          "relative",
          props.inactive ? "text-muted-foreground/50" : "text-sidebar-primary",
        )}
        style={{ height: HEIGHT }}
        role="img"
        aria-label={props.label}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHovered(null)}
      >
        <svg
          viewBox={`0 0 100 ${HEIGHT}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
          aria-hidden
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.3} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} />
          <path
            d={line}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {marked && (
          <span
            aria-hidden
            className="bg-border absolute inset-y-0 w-px"
            style={{ left: `${marked[0]}%` }}
          />
        )}
        {(marked ?? last) && (
          <span
            aria-hidden
            className="ring-background absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current ring-2"
            style={{
              left: `${(marked ?? last)![0]}%`,
              top: `${((marked ?? last)![1] / HEIGHT) * 100}%`,
            }}
          />
        )}
      </div>
      <div
        className={cn(
          "flex items-baseline gap-1 text-xs whitespace-nowrap",
          props.inactive && "text-muted-foreground",
        )}
      >
        {hovered === null ? (
          <>
            <span className="font-semibold tabular-nums">{l(total)}</span>
            <span className="text-muted-foreground">
              {total === 1
                ? tr("home.table.momentum.event")
                : tr("home.table.momentum.events")}
            </span>
            {total === 0 || delta === 0 ? (
              <span className="text-muted-foreground">
                {tr("home.table.momentum.flat")}
              </span>
            ) : (
              delta !== undefined && (
                <span
                  className={cn(
                    "tabular-nums",
                    delta > 0 && !props.inactive
                      ? "text-sidebar-primary"
                      : "text-muted-foreground",
                  )}
                  title={tr("home.table.momentum.delta.hint")}
                >
                  {tr("home.table.momentum.delta", {
                    args: [`${delta > 0 ? "+" : ""}${l(delta)}`],
                  })}
                </span>
              )
            )}
          </>
        ) : (
          <>
            <span className="font-semibold tabular-nums">
              {l(props.counts[hovered] ?? 0)}
            </span>
            <span className="text-muted-foreground">
              {l(props.days[hovered] ?? "", { date: "ll" })}
            </span>
          </>
        )}
      </div>
    </div>
  );
};
