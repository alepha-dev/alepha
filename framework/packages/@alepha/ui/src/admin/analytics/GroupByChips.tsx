import { useI18n } from "alepha/react/i18n";

import { ANALYTICS_MAX_POINTS } from "./analyticsModel.ts";
import type { AnalyticsTimeGrain } from "./analyticsTypes.ts";
import { ClauseLabel } from "./ClauseLabel.tsx";
import { ToggleChip } from "./ToggleChip.tsx";

export interface GroupByChipsProps {
  dataset: string;
  dimensions: string[];
  groupBy: string[];
  /**
   * The dataset's time grains, each with why it is locked over the current
   * window.
   */
  grains: Array<{
    grain: AnalyticsTimeGrain;
    lock: "retention" | "points" | null;
  }>;
  onToggle: (name: string) => void;
}

/**
 * The `group by` clause: the declared dimensions, then the time grains.
 *
 * Selected chips carry an ordinal because `groupBy` is ordered: the first key
 * is the chart's x-axis and the second becomes its breakdown, so the order is
 * a thing you choose rather than an accident of clicking.
 *
 * The time grains (`minute` on a sub-hour dataset, `hour`, `day`) sit in their
 * own sub-row rather than a clause of their own. They *are* groupBy keys in
 * the API, the same field as `path` or `country`, so they belong to this
 * clause. But they carry constraints no real dimension has, so they are set
 * apart: a grain locks when the window starts before its tier still holds
 * exact buckets, or when it would draw more points than a chart can show. A
 * locked grain that is selected is sent as the finest one the window allows.
 */
export const GroupByChips = (props: GroupByChipsProps) => {
  const { tr } = useI18n();

  const lockTitle = (name: string, lock: "retention" | "points") =>
    // The whole explanation lives in this tooltip and nowhere else: it only
    // matters at the moment someone reaches for the chip.
    lock === "retention"
      ? tr("admin.analytics.grainLockedRetention", {
          default:
            "$1 is locked. $2 keeps $1 buckets for less than this range, and older readings sit in coarser buckets, which would not merge.",
          args: [name, props.dataset],
        })
      : tr("admin.analytics.grainLockedPoints", {
          default:
            "$1 is locked. This range would draw more than $2 $1 buckets.",
          args: [name, String(ANALYTICS_MAX_POINTS)],
        });

  const chip = (name: string, lock: "retention" | "points" | null = null) => {
    const index = props.groupBy.indexOf(name);
    return (
      <ToggleChip
        key={name}
        pressed={index >= 0}
        order={index >= 0 ? index + 1 : undefined}
        locked={lock !== null}
        onToggle={() => props.onToggle(name)}
        title={
          lock
            ? lockTitle(name, lock)
            : tr("admin.analytics.groupByKey", {
                default: "group by $1",
                args: [name],
              })
        }
      >
        <code className="text-[11.5px]">{name}</code>
      </ToggleChip>
    );
  };

  return (
    <div className="flex flex-col gap-[7px]">
      <ClauseLabel>group by</ClauseLabel>
      <div className="flex flex-wrap gap-1.5">
        {props.dimensions.map((name) => chip(name))}
      </div>
      <div className="flex flex-col gap-1.5 pt-0.5">
        <span className="text-muted-foreground text-[10.5px]">by time</span>
        <div className="flex flex-wrap gap-1.5">
          {props.grains
            .toReversed()
            .map((entry) => chip(entry.grain, entry.lock))}
        </div>
      </div>
    </div>
  );
};
