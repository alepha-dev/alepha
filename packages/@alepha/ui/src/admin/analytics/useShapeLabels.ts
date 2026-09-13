import { useI18n } from "alepha/react/i18n";
import {
  Activity,
  AlignLeft,
  BarChart3,
  Grid3x3,
  Layers,
  PieChart,
} from "lucide-react";
import type { ComponentType } from "react";

import type { AnalyticsChartShape } from "./analyticsTypes.ts";

export const ANALYTICS_SHAPE_ICONS: Record<
  AnalyticsChartShape,
  ComponentType<{ className?: string }>
> = {
  bars: BarChart3,
  line: Activity,
  share: Layers,
  rank: AlignLeft,
  donut: PieChart,
  heat: Grid3x3,
};

export interface ShapeLabelsApi {
  /**
   * The picker's tooltip: what this shape is.
   */
  title: (shape: AnalyticsChartShape) => string;
  /**
   * The running description used in the chart note and the view note. Bars
   * read differently once a breakdown is stacked into them, so the label says
   * which one you are looking at.
   */
  label: (shape: AnalyticsChartShape, stacked: boolean) => string;
}

/**
 * The six shapes, named. A hook rather than a constant because both the chart
 * header and the results pane's note need the same words, and words are
 * translated.
 */
export const useShapeLabels = (): ShapeLabelsApi => {
  const { tr } = useI18n();

  return {
    title: (shape) =>
      ({
        bars: tr("admin.analytics.shapeBars", { default: "Bars" }),
        line: tr("admin.analytics.shapeLine", { default: "Line" }),
        share: tr("admin.analytics.shapeShare", { default: "100% share" }),
        rank: tr("admin.analytics.shapeRank", { default: "Ranking" }),
        donut: tr("admin.analytics.shapeDonut", {
          default: "Donut, share of total",
        }),
        heat: tr("admin.analytics.shapeHeat", {
          default: "Day by hour heatmap",
        }),
      })[shape],
    label: (shape, stacked) =>
      shape === "bars" && stacked
        ? tr("admin.analytics.labelStackedBars", { default: "stacked bars" })
        : {
            bars: tr("admin.analytics.labelBars", { default: "bars" }),
            line: tr("admin.analytics.labelLine", { default: "line" }),
            share: tr("admin.analytics.labelShare", { default: "100% share" }),
            rank: tr("admin.analytics.labelRank", { default: "ranking" }),
            donut: tr("admin.analytics.labelDonut", { default: "donut" }),
            heat: tr("admin.analytics.labelHeat", { default: "heatmap" }),
          }[shape],
  };
};
