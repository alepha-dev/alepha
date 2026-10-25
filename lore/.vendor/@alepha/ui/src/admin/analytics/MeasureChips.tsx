import { useI18n } from "alepha/react/i18n";

import { ClauseLabel } from "./ClauseLabel.tsx";
import { ToggleChip } from "./ToggleChip.tsx";

export interface MeasureChipsProps {
  measures: string[];
  active: string[];
  onToggle: (name: string) => void;
}

/**
 * The `select` clause: which measures are summed.
 *
 * Sums only. That is the query language and not a simplification of it: `sum`
 * is the one aggregate that survives a rollup and stays exactly correctable
 * under a sampling backend, which is why there is no avg or percentile picker
 * to add here.
 *
 * At least one measure stays selected: clicking the last active chip is a
 * no-op, since an empty `select` is a query the backend refuses.
 */
export const MeasureChips = (props: MeasureChipsProps) => {
  const { tr } = useI18n();
  const only = props.active.length === 1;

  return (
    <div className="flex flex-col gap-[7px]">
      <ClauseLabel>select</ClauseLabel>
      <div className="flex flex-wrap gap-1.5">
        {props.measures.map((measure) => {
          const on = props.active.includes(measure);
          return (
            <ToggleChip
              key={measure}
              pressed={on}
              onToggle={() => props.onToggle(measure)}
              title={
                on && only
                  ? tr("admin.analytics.lastMeasure", {
                      default: "At least one measure has to stay selected.",
                    })
                  : undefined
              }
            >
              <code className="text-[11.5px]">sum({measure})</code>
            </ToggleChip>
          );
        })}
      </div>
    </div>
  );
};
