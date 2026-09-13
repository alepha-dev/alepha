import { AnalyticsChartBars } from "./AnalyticsChartBars.tsx";
import { AnalyticsChartDonut } from "./AnalyticsChartDonut.tsx";
import { AnalyticsChartHeader } from "./AnalyticsChartHeader.tsx";
import { AnalyticsChartHeat } from "./AnalyticsChartHeat.tsx";
import { AnalyticsChartLegend } from "./AnalyticsChartLegend.tsx";
import { AnalyticsChartLine } from "./AnalyticsChartLine.tsx";
import { AnalyticsChartRank } from "./AnalyticsChartRank.tsx";
import { AnalyticsChartTicks } from "./AnalyticsChartTicks.tsx";
import type { AnalyticsChartShape } from "./analyticsTypes.ts";
import type { AnalyticsChartModel } from "./chartModel.ts";

export interface AnalyticsChartProps {
  model: AnalyticsChartModel;
  groupBy: string[];
  measures: string[];
  onShape: (shape: AnalyticsChartShape) => void;
  onAxis: (axis: string) => void;
  onMeasure: (measure: string) => void;
}

/**
 * One chart, in whichever of the six shapes the grouping supports.
 *
 * Every shape reads the same folded result, so switching between them can
 * never show two different numbers for one thing. Only bars and 100% share
 * draw the breakdown; the others sum across it, and the header's note says
 * so.
 */
export const AnalyticsChart = (props: AnalyticsChartProps) => {
  const model = props.model;
  const vertical = model.shape === "bars" || model.shape === "share";

  return (
    <div className="px-5 pt-[18px]">
      <AnalyticsChartHeader
        model={model}
        groupBy={props.groupBy}
        measures={props.measures}
        onShape={props.onShape}
        onAxis={props.onAxis}
        onMeasure={props.onMeasure}
      />
      {vertical && (
        <AnalyticsChartBars
          points={model.points}
          slots={model.slots}
          max={model.max}
          normalised={model.shape === "share"}
        />
      )}
      {model.shape === "line" && (
        <AnalyticsChartLine points={model.points} max={model.max} />
      )}
      {(vertical || model.shape === "line") && (
        <AnalyticsChartTicks points={model.points} />
      )}
      {model.shape === "rank" && (
        <AnalyticsChartRank points={model.points} max={model.max} />
      )}
      {model.shape === "donut" && (
        <AnalyticsChartDonut points={model.points} total={model.total} />
      )}
      {model.shape === "heat" && <AnalyticsChartHeat rows={model.heat ?? []} />}
      {model.slots.length > 0 && vertical && (
        <AnalyticsChartLegend slots={model.slots} />
      )}
    </div>
  );
};
