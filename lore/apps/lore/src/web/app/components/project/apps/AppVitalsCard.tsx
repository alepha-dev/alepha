import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useI18n } from "alepha/react/i18n";

import type { VitalsMetricResource } from "@/api/schemas/vitalsMetricSchema.ts";

import type { I18n } from "../../../services/I18n.ts";
import AppVitalsDistribution from "./AppVitalsDistribution.tsx";

/**
 * Below this many samples a reading is a hint, not a measurement.
 *
 * Chosen against what the real instance holds rather than from a table: of the
 * seven enrolled apps measured on 2026-08-21, LCP sample counts were 346, 270,
 * 125, 39, 13, 7 and 1. A threshold of 30 is the line that separates the four
 * worth reading from the three that were being rendered with exactly the same
 * confidence - one of which stated a p75 from a single sample.
 */
const MIN_SAMPLES = 30;

export type VitalRating = "good" | "needsImprovement" | "poor";

export interface AppVitalsCardProps {
  metricKey: "lcp" | "inp" | "cls" | "fcp" | "ttfb";
  /**
   * The metric's own good / poor p75 thresholds, in its own unit.
   */
  good: number;
  poor: number;
  unit: "ms" | null;
  data: VitalsMetricResource;
}

// Literal key strings (not template-interpolated) so the i18n audit sees them.
const METRIC_LABEL: Record<
  AppVitalsCardProps["metricKey"],
  | "insights.vitals.lcp"
  | "insights.vitals.inp"
  | "insights.vitals.cls"
  | "insights.vitals.fcp"
  | "insights.vitals.ttfb"
> = {
  lcp: "insights.vitals.lcp",
  inp: "insights.vitals.inp",
  cls: "insights.vitals.cls",
  fcp: "insights.vitals.fcp",
  ttfb: "insights.vitals.ttfb",
};

const RATING_LABEL: Record<
  VitalRating,
  | "insights.vitals.good"
  | "insights.vitals.needsImprovement"
  | "insights.vitals.poor"
> = {
  good: "insights.vitals.good",
  needsImprovement: "insights.vitals.needsImprovement",
  poor: "insights.vitals.poor",
};

const RATING_DOT: Record<VitalRating, string> = {
  good: "bg-emerald-500",
  needsImprovement: "bg-amber-500",
  poor: "bg-red-500",
};

const RATING_TEXT: Record<VitalRating, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  needsImprovement: "text-amber-600 dark:text-amber-400",
  poor: "text-red-600 dark:text-red-400",
};

/**
 * One metric: the range its p75 falls in, how many samples say so, and the
 * shape behind both.
 *
 * The headline is a RANGE because the store holds bucket counts and a range is
 * what they support. Printing the bucket's ceiling as a millisecond figure made
 * five of seven production apps report an LCP of exactly 1800 ms - the
 * algorithm showing through, read as fabricated data, and pessimistic besides,
 * since the ceiling is the worst value in the bucket.
 */
const AppVitalsCard = (props: AppVitalsCardProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { metricKey, good, poor, unit, data } = props;

  /**
   * A bound, with the unit only where it belongs.
   *
   * The unit rides on the upper bound alone, so a range reads "1,000 to
   * 1,800 ms" rather than repeating itself. CLS has no unit and both ends
   * format the same way.
   */
  const format = (value: number, withUnit = true) =>
    unit === "ms"
      ? `${value.toLocaleString()}${withUnit ? " ms" : ""}`
      : value.toFixed(2);

  /**
   * How a bucket rates, from its own ceiling.
   *
   * Per BUCKET rather than per value, which is the point: the boundaries were
   * chosen around the thresholds, so a bucket lies entirely inside one band and
   * "good" can mean "the p75 landed in a good bucket" instead of "the ceiling
   * of its bucket happened to be under a number".
   */
  const ratingOf = (index: number): VitalRating => {
    const ceiling = data.boundaries[index];
    // The overflow bucket has no ceiling. Worse than every boundary is poor by
    // construction, and inventing a value for it would be the same lie the
    // headline just stopped telling.
    if (ceiling === undefined) return "poor";
    if (ceiling <= good) return "good";
    if (ceiling <= poor) return "needsImprovement";
    return "poor";
  };

  const ratings = data.boundaries
    .map((_, index) => ratingOf(index))
    .concat(ratingOf(data.boundaries.length));

  const confident = data.samples >= MIN_SAMPLES;
  const rating = data.p75Bucket === null ? null : ratingOf(data.p75Bucket);

  const headline = () => {
    if (data.samples === 0) {
      // INP is empty for four of seven production apps and that is expected,
      // not broken: it needs a real interaction to exist at all. Saying so is
      // the difference between a card that looks unfinished and one that
      // reports a real state.
      return metricKey === "inp"
        ? tr("insights.vitals.noInteractions")
        : tr("insights.vitals.noSamples");
    }
    if (data.p75Upper === null) {
      // Overflow: worse than the last boundary, with no ceiling to name.
      return tr("insights.vitals.over", {
        args: [format(data.boundaries[data.boundaries.length - 1] ?? 0)],
      });
    }
    return tr("insights.vitals.range", {
      args: [format(data.p75Lower ?? 0, false), format(data.p75Upper)],
    });
  };

  return (
    <Card data-testid={`vitals-${metricKey}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground flex items-center justify-between text-sm font-medium">
          <span className="tracking-wide uppercase">
            {tr(METRIC_LABEL[metricKey])}
          </span>
          {rating && confident && (
            <span
              className={`flex items-center gap-1.5 text-xs font-medium ${RATING_TEXT[rating]}`}
            >
              <span className={`size-2 rounded-full ${RATING_DOT[rating]}`} />
              {tr(RATING_LABEL[rating])}
            </span>
          )}
          {/*
            A distinct state rather than a quieter version of the same claim.
            One production app rated its LCP off 7 samples and another off 1,
            and both cards looked exactly like the one built on 346.
          */}
          {rating && !confident && (
            <span className="text-muted-foreground text-xs font-medium">
              {tr("insights.vitals.lowConfidence")}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="text-2xl font-bold tabular-nums">{headline()}</div>

        <AppVitalsDistribution
          buckets={data.buckets}
          ratings={ratings}
          p75Bucket={data.p75Bucket}
          label={(index, count) => {
            const ceiling = data.boundaries[index];
            const band =
              ceiling === undefined
                ? tr("insights.vitals.over", {
                    args: [
                      format(data.boundaries[data.boundaries.length - 1] ?? 0),
                    ],
                  })
                : tr("insights.vitals.range", {
                    args: [
                      format(data.boundaries[index - 1] ?? 0, false),
                      format(ceiling),
                    ],
                  });
            return `${band}: ${count}`;
          }}
        />

        {/*
          Always on screen, never derived by the reader from the bar. It is the
          number that decides whether the rest of the card is worth reading.
        */}
        <div className="text-muted-foreground text-xs">
          {tr("insights.vitals.samples", {
            args: [data.samples.toLocaleString()],
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export default AppVitalsCard;
