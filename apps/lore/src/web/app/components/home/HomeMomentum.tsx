import { cn } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { I18n } from "../../services/I18n.ts";
import { momentumBarHeights, momentumDelta } from "./homeMomentumBars.ts";

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
   * The bars themselves are decoration and carry no text.
   */
  label: string;
  /**
   * Whether the project has gone quiet (`HOME_INACTIVE_AFTER_DAYS`): the
   * bars and their text turn grey, so the table's eye goes to the live rows.
   */
  inactive?: boolean;
}

/**
 * The chart's height, in pixels, which is also the height of a bar standing
 * at the ceiling.
 */
const HEIGHT = 32;

/**
 * Fourteen days of a project's recorded writes, one bar per day, with the
 * total and the week-on-week change under them.
 *
 * ## Bars, because the axis is days and days are discrete
 *
 * A line interpolates: between a busy Tuesday and an empty Wednesday it
 * draws values nothing was ever measured at, and its smoothing has to be
 * held back from dipping under zero. Fourteen counted days are fourteen
 * separate readings, and a bar each says exactly that and nothing more. It
 * also makes an empty day legible, which a line through the baseline cannot
 * distinguish from a quiet one.
 *
 * A bar takes three quarters of its day's column rather than all of it: the
 * leftover is the air that separates it from its neighbours, so fourteen
 * busy days read as fourteen bars and not as one filled block.
 *
 * ## The scale is shared, and that is the whole point
 *
 * Every row is drawn against the busiest day in the table, not its own. See
 * `momentumBarHeights`.
 *
 * ## One colour, from the theme
 *
 * The bars are `--sidebar-primary`, the colour of the sidebar's active-item
 * bar: every theme gives it its own hue in both modes, so light, dark and
 * each theme need nothing of their own here. The bars read it through
 * `currentColor`, which is also how an inactive row turns the whole chart
 * grey in one class. A rise wears the same colour; a fall and "flat" stay
 * muted, since a quieter week is not a fault.
 *
 * ## Hover reads a day in place
 *
 * Each day owns a full-height column, its air included, so the hit target is
 * larger than the bar and the pointer never falls between two of them. The
 * hovered bar keeps its colour while the rest fade, and the line under the
 * chart shows that day's count and date instead of the totals. In place
 * rather than in a floating tooltip, which the table's own scroll container
 * would clip on the first rows.
 *
 * Plain elements rather than an SVG: a `viewBox` stretched to the cell with
 * `preserveAspectRatio="none"` would squash every bar's width with it, and
 * undoing that per bar costs more than laying them out with flex.
 */
export const HomeMomentum = (props: HomeMomentumProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const [hovered, setHovered] = useState<number | null>(null);

  const bars = momentumBarHeights(props.counts, props.ceiling, HEIGHT);
  const total = props.counts.reduce((sum, count) => sum + count, 0);
  const delta = momentumDelta(props.counts);

  /**
   * One opacity per bar, as a single class rather than two that `cn` has to
   * resolve against each other: hovering one day recedes the other thirteen,
   * and a day with nothing on it stays a baseline tick rather than a value.
   */
  const barOpacity = (index: number) => {
    if (hovered !== null && hovered !== index) return "opacity-30";
    return props.counts[index] ? "opacity-100" : "opacity-40";
  };

  return (
    <div className="flex w-52 flex-col gap-1">
      <div
        className={cn(
          "flex items-end",
          props.inactive ? "text-muted-foreground/50" : "text-sidebar-primary",
        )}
        style={{ height: HEIGHT }}
        role="img"
        aria-label={props.label}
        onPointerLeave={() => setHovered(null)}
      >
        {bars.map((bar, index) => (
          <div
            key={props.days[index] ?? index}
            className="flex h-full flex-1 items-end justify-center"
            onPointerEnter={() => setHovered(index)}
          >
            <span
              aria-hidden
              className={cn(
                "w-3/4 rounded-t-xs bg-current transition-opacity",
                barOpacity(index),
              )}
              style={{ height: bar }}
            />
          </div>
        ))}
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
