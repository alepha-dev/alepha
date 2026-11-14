import { type Infer, z } from "alepha";

/**
 * Web vitals broken down by page: the half of the Vitals tab that is
 * actionable.
 *
 * `path` has been a declared dimension on `sigil_vitals` since the dataset
 * existed, written on every sample, and no query had ever grouped by it. The
 * five metric cards say whether there is a problem; only this says where.
 *
 * A separate action rather than a field on the insights payload, for the reason
 * the single-dimension leaderboard is one: the two tabs share a cache entry, so
 * folding this in would make Analytics pay two more grouped queries to draw a
 * table it never renders.
 */
export const vitalsPathsResourceSchema = z.object({
  range: z.enum(["1d", "7d", "30d"]),
  since: z.string(),
  until: z.string(),
  /**
   * The bucket ceilings per metric, un-scaled, so a row can be labelled
   * without repeating six numbers per path per metric.
   */
  boundaries: z.record(z.string(), z.array(z.number())),
  /**
   * Below this many samples a path's reading is a hint, not a measurement.
   * Echoed so the client renders the same floor the ranking applied.
   */
  minSamples: z.integer(),
  rows: z.array(
    z.object({
      path: z.string(),
      /**
       * Every metric's samples for this path, summed. The number that decides
       * whether the row is worth reading at all.
       */
      samples: z.integer(),
      /**
       * Share of this path's samples that landed in a POOR bucket, whole
       * percent.
       *
       * The ranking key, and deliberately not the p75. A p75 is a bucket
       * ceiling, so every path landing in the same bucket ties, and the order
       * among them is arbitrary. The tail share separates them and is the
       * number that names the problem page: it says how much of this route's
       * traffic had a bad time, not merely that its middle was acceptable.
       */
      tailShare: z.number(),
      /**
       * Whether `samples` clears {@link minSamples}.
       *
       * A path with three samples will happily claim to be the worst on the
       * site. Rows that do not clear the floor are ranked below every row that
       * does and marked, rather than hidden: "not enough data about this page"
       * is a real answer and dropping it silently is not.
       */
      confident: z.boolean(),
      metrics: z.record(
        z.string(),
        z.object({
          samples: z.integer(),
          /**
           * The p75's bucket, as a range. `null` where the path has no sample
           * for that metric, and `p75Upper` is also null in the overflow
           * bucket, which has no ceiling to name.
           */
          p75Lower: z.number().nullable(),
          p75Upper: z.number().nullable(),
        }),
      ),
    }),
  ),
  /**
   * Whether paths were left out of this answer.
   *
   * `path` is the highest-cardinality dimension on the dataset, so the list is
   * bounded rather than complete. True means the tail was cut, which a reader
   * ranking pages by how bad they are needs to know.
   */
  hasMore: z.boolean(),
  estimated: z.boolean(),
  sampleInterval: z.number().optional(),
});

export type VitalsPathsResource = Infer<typeof vitalsPathsResourceSchema>;
