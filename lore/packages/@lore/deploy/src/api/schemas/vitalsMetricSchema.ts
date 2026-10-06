import { type Infer, z } from "alepha";

/**
 * One Web Vitals metric, as the histogram behind it actually supports.
 *
 * ## Why this is not a number
 *
 * It used to be. `vitalsP75` walked the bucket counts and returned the UPPER
 * BOUNDARY of the bucket the percentile landed in, so an LCP was always one of
 * 1000 / 1800 / 2500 / 3000 / 4000 / 6000 and a CLS always one of 0.05 / 0.10 /
 * 0.15 / 0.25 / 0.40 / 0.60. Measured across seven production apps on
 * 2026-08-21, five of them reported LCP as exactly 1800 ms and CLS as exactly
 * 0.05 - which is not a coincidence about those apps, it is the algorithm
 * showing through. Three things were wrong with printing it:
 *
 * - **It read as fabricated**, because a round number repeated across unrelated
 *   apps is what fabricated data looks like.
 * - **It was systematically pessimistic**: the ceiling of the bucket, so a true
 *   p75 of 300 ms displayed as 1000 ms and a fast app was rated acceptable.
 * - **The sample count was invisible.** One app's 1800 ms rested on 7 samples
 *   and another's 4000 ms on 346, and the two cards were identical on screen.
 *
 * Storing raw samples would fix it and is not worth it: the whole point of a
 * histogram is that its cost does not grow with traffic. So the payload stops
 * claiming a precision it never had and reports what it has.
 */
export const vitalsMetricSchema = z.object({
  /**
   * How many samples the window holds for this metric.
   *
   * On the payload rather than derived from `buckets` so a reader cannot
   * forget to sum it, and because it is the number that decides whether the
   * rest is worth reading at all.
   */
  samples: z.integer(),
  /**
   * Counts per bucket, index-aligned with {@link boundaries}, plus one final
   * entry for the overflow bucket - so its length is always
   * `boundaries.length + 1`.
   *
   * The overflow entry is the one a single number hid completely: one app's
   * TTFB had 202 of 694 samples above every boundary, and the headline
   * `2000 ms` said nothing about the tail.
   */
  buckets: z.array(z.integer()),
  /**
   * The bucket boundaries, in the metric's own unit and already un-scaled for
   * CLS.
   *
   * Carried on the payload rather than left to the client to import, so the
   * chart labels itself from the same values the counts were bucketed with. A
   * UI holding its own copy is one deploy away from labelling a distribution
   * with someone else's boundaries.
   */
  boundaries: z.array(z.number()),
  /**
   * Which bucket the 75th percentile falls in, or `null` when the window holds
   * no sample.
   *
   * The rating is driven off THIS rather than off a comparison between two
   * boundary values, which is what makes "good" mean "the p75 landed in a good
   * bucket" instead of "the ceiling of its bucket happened to be under a
   * threshold".
   */
  p75Bucket: z.integer().nullable(),
  /**
   * Lower bound of the p75's bucket: the previous boundary, or `0` for the
   * first bucket. `null` when there is no sample.
   */
  p75Lower: z.number().nullable(),
  /**
   * Upper bound of the p75's bucket. `null` when there is no sample, and also
   * `null` for the overflow bucket, where the honest reading is "worse than
   * the last boundary" and there is no ceiling to name.
   */
  p75Upper: z.number().nullable(),
});

export type VitalsMetricResource = Infer<typeof vitalsMetricSchema>;
