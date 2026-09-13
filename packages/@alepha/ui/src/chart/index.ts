/**
 * Charts, on recharts.
 *
 * `ChartContainer` with its tooltip and legend parts, themed from the chart
 * tokens. Opt-in: nothing else in `@alepha/ui` imports it, so an app that draws
 * no chart never loads recharts.
 *
 * @module alepha.ui.chart
 */

export {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
  ChartTooltip,
  ChartTooltipContent,
} from "./Chart.tsx";
