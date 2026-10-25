import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { ArrowRight } from "lucide-react";

import { Segmented } from "../../core/Segmented.tsx";
import { ControlDate } from "../../form/ControlDate.tsx";
import {
  ANALYTICS_RANGES,
  ANALYTICS_RELATIVE_RANGES,
  analyticsWindowEnds,
} from "./analyticsModel.ts";
import type {
  AnalyticsInstantRange,
  AnalyticsWindow,
} from "./analyticsTypes.ts";
import { ClauseLabel } from "./ClauseLabel.tsx";
import { instantRangeSchema } from "./instantRangeSchema.ts";

export interface RangeControlProps {
  days: number;
  instant: AnalyticsInstantRange | null;
  window: AnalyticsWindow;
  onDays: (days: number) => void;
  onInstant: (instant: AnalyticsInstantRange) => void;
}

/**
 * The `on range` clause: how long the window is.
 *
 * Whole days (a length: `until` in Advanced decides where it ends), a recent
 * span in minutes or hours, or two instants picked in the browser's own
 * timezone. The last two are sent as `from`/`to` with the browser's offset,
 * so a monitoring view reads "the last 15 minutes" exactly. The resolved
 * bounds underneath are what the controls add up to. The label is `on range`
 * rather than "window" because the alerts editor already owns that word for
 * its evaluation window.
 */
export const RangeControl = (props: RangeControlProps) => {
  const { tr } = useI18n();
  const ends = analyticsWindowEnds(props.window);
  const absolute =
    props.instant?.kind === "absolute" ? props.instant : undefined;

  const form = useForm({
    schema: instantRangeSchema,
    initialValues: { from: absolute?.from, to: absolute?.to },
    handler: () => {},
    // Applied as soon as both ends are picked, in order.
    onChange: (_key, _value, store) => {
      const from = store.from as string | undefined;
      const to = store.to as string | undefined;
      if (from && to && Date.parse(from) < Date.parse(to)) {
        props.onInstant({ kind: "absolute", from, to });
      }
    },
  });

  return (
    <div className="flex flex-col gap-[7px]">
      <ClauseLabel>on range</ClauseLabel>
      <Segmented
        className="self-start"
        size="sm"
        value={props.instant ? "" : String(props.days)}
        onChange={(value) => props.onDays(Number(value))}
        options={ANALYTICS_RANGES.map((days) => ({
          value: String(days),
          label: `${days}d`,
        }))}
      />
      <Segmented
        className="self-start"
        size="sm"
        value={
          props.instant?.kind === "relative"
            ? String(props.instant.minutes)
            : ""
        }
        onChange={(value) =>
          props.onInstant({ kind: "relative", minutes: Number(value) })
        }
        options={ANALYTICS_RELATIVE_RANGES.map((range) => ({
          value: String(range.minutes),
          label: range.label,
        }))}
      />
      <div className="grid grid-cols-2 gap-1.5">
        <ControlDate
          input={form.input.from}
          datetime
          label={tr("admin.analytics.rangeFrom", { default: "from" })}
        />
        <ControlDate
          input={form.input.to}
          datetime
          label={tr("admin.analytics.rangeTo", { default: "to" })}
        />
      </div>
      <div className="text-muted-foreground flex items-center gap-1.5 font-mono text-[11px]">
        <span>{ends.from}</span>
        <ArrowRight className="size-[11px]" />
        <span>{ends.to}</span>
      </div>
    </div>
  );
};
