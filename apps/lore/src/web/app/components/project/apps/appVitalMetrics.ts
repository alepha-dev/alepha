import { VITALS_THRESHOLDS } from "@alepha/lore/sigil";

/**
 * The five metrics, in the order the tab shows them, with the label key and the
 * unit each needs.
 *
 * The thresholds are NOT restated here: they come from `@alepha/lore`'s
 * `VITALS_THRESHOLDS`, in the same scale as the buckets, so the colour on a
 * card and the ranking the endpoint applies to a path cannot disagree about
 * what "poor" means. CLS is stored ×1000 like its boundaries and un-scaled
 * once, here, exactly as the payload's boundaries are.
 *
 * One list, so the metric cards and the per-path table iterate the same order
 * and a sixth metric appears in both without a second edit.
 */
export const VITAL_METRICS = [
  { metricKey: "lcp", labelKey: "insights.vitals.lcp", unit: "ms" },
  { metricKey: "inp", labelKey: "insights.vitals.inp", unit: "ms" },
  { metricKey: "cls", labelKey: "insights.vitals.cls", unit: null },
  { metricKey: "fcp", labelKey: "insights.vitals.fcp", unit: "ms" },
  { metricKey: "ttfb", labelKey: "insights.vitals.ttfb", unit: "ms" },
] as const satisfies ReadonlyArray<{
  metricKey: keyof typeof VITALS_THRESHOLDS;
  labelKey:
    | "insights.vitals.lcp"
    | "insights.vitals.inp"
    | "insights.vitals.cls"
    | "insights.vitals.fcp"
    | "insights.vitals.ttfb";
  unit: "ms" | null;
}>;

/**
 * A metric's good / poor thresholds in the unit the payload reports it in.
 *
 * CLS alone is stored scaled, and it is un-scaled here rather than at each call
 * site, which is the same rule the boundaries follow.
 */
export const vitalThresholds = (
  metric: keyof typeof VITALS_THRESHOLDS,
): { good: number; poor: number } => {
  const scale = metric === "cls" ? 1000 : 1;
  const { good, poor } = VITALS_THRESHOLDS[metric];
  return { good: good / scale, poor: poor / scale };
};
