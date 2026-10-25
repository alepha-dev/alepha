import { useI18n } from "alepha/react/i18n";

import { ClauseLabel } from "./ClauseLabel.tsx";
import { ToggleChip } from "./ToggleChip.tsx";

export interface GroupByChipsProps {
  dataset: string;
  dimensions: string[];
  groupBy: string[];
  days: number;
  hotDays: number | null;
  hourAllowed: boolean;
  onToggle: (name: string) => void;
}

/**
 * The `group by` clause: the declared dimensions, then the two time grains.
 *
 * Selected chips carry an ordinal because `groupBy` is ordered: the first key
 * is the chart's x-axis and the second becomes its breakdown, so the order is
 * a thing you choose rather than an accident of clicking.
 *
 * `day` and `hour` sit in their own sub-row rather than a clause of their
 * own. They *are* groupBy keys in the API, the same field as `path` or
 * `country`, so they belong to this clause. But they are bucket keys with a
 * retention constraint no real dimension has, so they are set apart. They do
 * not move into Advanced either: they drive the chart's x-axis, you change
 * them constantly, and a control that can lock itself out looks broken when
 * it is hidden.
 */
export const GroupByChips = (props: GroupByChipsProps) => {
  const { tr } = useI18n();

  const chip = (name: string, locked = false) => {
    const index = props.groupBy.indexOf(name);
    return (
      <ToggleChip
        key={name}
        pressed={index >= 0}
        order={index >= 0 ? index + 1 : undefined}
        locked={locked}
        onToggle={() => props.onToggle(name)}
        title={
          locked
            ? // The whole explanation lives in this tooltip and nowhere else:
              // it only matters at the moment someone reaches for the chip.
              tr("admin.analytics.hourLocked", {
                default:
                  "hour is locked. $1 keeps raw hourly buckets for $2 days, and a $3-day range reaches the rolled daily tier. Those are different keys, so they would not merge.",
                args: [
                  props.dataset,
                  String(props.hotDays ?? 0),
                  String(props.days),
                ],
              })
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
          {chip("day")}
          {chip("hour", !props.hourAllowed)}
        </div>
      </div>
    </div>
  );
};
