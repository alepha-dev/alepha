import { Segmented } from "@alepha/ui/components/ui/segmented";
import { useI18n } from "alepha/react/i18n";

import type { AnalyticsChartShape } from "./analyticsTypes.ts";
import type { AnalyticsChartModel } from "./chartModel.ts";
import { ANALYTICS_SHAPE_ICONS, useShapeLabels } from "./useShapeLabels.ts";

export interface AnalyticsChartHeaderProps {
  model: AnalyticsChartModel;
  groupBy: string[];
  measures: string[];
  onShape: (shape: AnalyticsChartShape) => void;
  onAxis: (axis: string) => void;
  onMeasure: (measure: string) => void;
}

/**
 * What the chart is, and the three ways to change it.
 *
 * The note is the honest part. It names the count being drawn, says when a
 * ranking is a top-N of something larger, and names any grouped key the shape
 * summed across instead of drawing. A chart that silently discards a
 * dimension is worse than one that refuses.
 */
export const AnalyticsChartHeader = (props: AnalyticsChartHeaderProps) => {
  const { tr } = useI18n();
  const labels = useShapeLabels();
  const model = props.model;
  const stacked =
    !!model.breakdown && (model.shape === "bars" || model.shape === "share");

  const title =
    model.shape === "heat"
      ? `sum(${model.measure}) by day × hour`
      : `sum(${model.measure}) by ${model.xKey}${stacked ? ` × ${model.breakdown}` : ""}`;

  const count =
    model.shape === "heat"
      ? tr("admin.analytics.noteHeat", {
          default: "$1 days × 24 hours",
          args: [String(model.heat?.length ?? 0)],
        })
      : model.chronological
        ? model.xKey === "day"
          ? tr("admin.analytics.noteDays", {
              default: "$1 days",
              args: [String(model.points.length)],
            })
          : tr("admin.analytics.noteHours", {
              default: "$1 hours",
              args: [String(model.points.length)],
            })
        : tr("admin.analytics.noteTopOf", {
            default: "top $1 of $2",
            args: [String(model.points.length), String(model.seriesLength)],
          });

  const note = [
    // Leading, not trailing: with no time grain at all the reader has to know
    // that before they read the count.
    model.timeKey
      ? null
      : tr("admin.analytics.noteNoTimeGrain", { default: "no time grain" }),
    count,
    model.collapsed.length > 0
      ? tr("admin.analytics.noteSummedAcross", {
          default: "summed across $1",
          args: [model.collapsed.join(", ")],
        })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-2">
      <span className="text-muted-foreground flex-none text-[10.5px] font-semibold tracking-[0.09em] whitespace-nowrap uppercase">
        {title}
      </span>
      <span className="text-muted-foreground flex-none text-[11.5px] whitespace-nowrap">
        {note}
      </span>
      <span className="min-w-3 flex-1" />
      {props.groupBy.length > 1 && (
        <>
          <span className="text-muted-foreground flex-none text-[11.5px]">
            {tr("admin.analytics.axis", { default: "axis" })}
          </span>
          <Segmented
            size="xs"
            className="flex-none"
            value={model.xKey}
            onChange={props.onAxis}
            options={props.groupBy.map((key) => ({
              value: key,
              label: <code className="text-[11px]">{key}</code>,
            }))}
          />
        </>
      )}
      <Segmented
        size="xs"
        className="flex-none"
        value={model.shape}
        onChange={(value) => props.onShape(value as AnalyticsChartShape)}
        options={model.available.map((shape) => {
          const Icon = ANALYTICS_SHAPE_ICONS[shape];
          return {
            value: shape,
            label: (
              <span
                title={labels.title(shape)}
                className="inline-flex items-center"
              >
                <Icon className="size-3" />
              </span>
            ),
          };
        })}
      />
      {props.measures.length > 1 && (
        <Segmented
          size="xs"
          className="flex-none"
          value={model.measure}
          onChange={props.onMeasure}
          options={props.measures.map((measure) => ({
            value: measure,
            label: <code className="text-[11px]">{measure}</code>,
          }))}
        />
      )}
    </div>
  );
};
