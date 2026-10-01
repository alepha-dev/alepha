import { analyticsSlotColor } from "./chartModel.ts";

export interface AnalyticsChartLegendProps {
  slots: string[];
}

/**
 * The breakdown's series, named. Only the shapes that actually draw the
 * breakdown render one.
 */
export const AnalyticsChartLegend = (props: AnalyticsChartLegendProps) => (
  <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5">
    {props.slots.map((slot, index) => (
      <span
        key={slot}
        className="text-muted-foreground inline-flex items-center gap-1.5 text-[11.5px]"
      >
        <span
          style={{ background: analyticsSlotColor(index) }}
          className="size-[9px] rounded-[3px]"
        />
        {slot}
      </span>
    ))}
  </div>
);
