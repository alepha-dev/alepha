import type { AdminDatasetDescriptor } from "alepha/api/analytics";
import { useI18n } from "alepha/react/i18n";

import { analyticsKeyLabel } from "./analyticsModel.ts";
import { ClauseLabel } from "./ClauseLabel.tsx";
import { ToggleChip } from "./ToggleChip.tsx";

export interface MeasureChipsProps {
  dataset: AdminDatasetDescriptor;
  /**
   * Every value key the dataset offers (see `analyticsMeasures`).
   */
  measures: string[];
  active: string[];
  onToggle: (name: string) => void;
}

/**
 * The `select` clause: one chip per fold a measure declares.
 *
 * A counter offers `sum(validations)` alone; a gauge offers each of its folds,
 * `min(temperature)`, `max(temperature)`, `last(temperature)`, so a band chart
 * is one query asking for all three. There is no avg or percentile chip to
 * add: neither survives a rollup.
 *
 * At least one value stays selected: clicking the last active chip is a
 * no-op, since an empty `select` is a query the backend refuses.
 */
export const MeasureChips = (props: MeasureChipsProps) => {
  const { tr } = useI18n();
  const only = props.active.length === 1;

  return (
    <div className="flex flex-col gap-[7px]">
      <ClauseLabel>select</ClauseLabel>
      <div className="flex flex-wrap gap-1.5">
        {props.measures.map((key) => {
          const on = props.active.includes(key);
          return (
            <ToggleChip
              key={key}
              pressed={on}
              onToggle={() => props.onToggle(key)}
              title={
                on && only
                  ? tr("admin.analytics.lastMeasure", {
                      default: "At least one measure has to stay selected.",
                    })
                  : undefined
              }
            >
              <code className="text-[11.5px]">
                {analyticsKeyLabel(props.dataset, key)}
              </code>
            </ToggleChip>
          );
        })}
      </div>
    </div>
  );
};
