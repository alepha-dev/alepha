import { cn } from "@alepha/ui/lib/utils";

export interface AppVitalsDistributionProps {
  /**
   * Sample counts per bucket, index-aligned with `boundaries` plus one final
   * overflow entry.
   */
  buckets: number[];
  /**
   * How each bucket index rates, so the bar is coloured by what the bucket
   * MEANS rather than by where it sits in the array.
   */
  ratings: Array<"good" | "needsImprovement" | "poor">;
  /**
   * Which bucket the p75 landed in, outlined so the headline range can be
   * found in the shape.
   */
  p75Bucket: number | null;
  /**
   * Renders a bucket's count as a title, e.g. "1,000 to 1,800 ms - 42 samples".
   */
  label: (index: number, count: number) => string;
}

const FILL: Record<AppVitalsDistributionProps["ratings"][number], string> = {
  good: "bg-emerald-500/70",
  needsImprovement: "bg-amber-500/70",
  poor: "bg-red-500/70",
};

/**
 * One metric's histogram as a stacked bar: where the samples actually are.
 *
 * The reason this exists at all is that a single p75 figure hid the tail
 * completely. One production app's TTFB had 202 of 694 samples above every
 * boundary while the card read `2000 ms`, which is both the ceiling of a
 * bucket and the smallest thing that could honestly be said about those 202.
 * A shape shows it; a number cannot.
 *
 * Segments are sized by share of samples, so an empty bucket takes no width
 * rather than a misleading sliver. A metric with no samples at all renders as
 * an empty track, which is a real state and reads as one.
 */
const AppVitalsDistribution = (props: AppVitalsDistributionProps) => {
  const { buckets, ratings, p75Bucket, label } = props;
  const total = buckets.reduce((sum, count) => sum + count, 0);

  return (
    <div className="bg-muted flex h-2 w-full overflow-hidden rounded-full">
      {total > 0 &&
        buckets.map((count, index) => {
          if (count === 0) {
            return null;
          }
          return (
            <div
              // Bucket index IS the identity here: the array is fixed-length
              // and index-aligned with the boundaries, so nothing reorders.
              key={index}
              title={label(index, count)}
              style={{ width: `${(count / total) * 100}%` }}
              className={cn(
                FILL[ratings[index] ?? "poor"],
                // The p75's own bucket, marked so the headline range can be
                // located in the shape rather than merely stated above it.
                index === p75Bucket && "ring-foreground/40 ring-1 ring-inset",
              )}
            />
          );
        })}
    </div>
  );
};

export default AppVitalsDistribution;
