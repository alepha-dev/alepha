import { $analytics } from "@alepha/analytics";
import { z } from "alepha";

/**
 * Lore's two portable analytics datasets.
 *
 * Views and vitals only. Unique visitors stay in `sigilUniquesDaily` because a
 * distinct count cannot survive sampling or a rollup, and error groups stay in
 * `sigilErrorGroups` because they keep the *first* stack sample, which needs a
 * read before every write.
 *
 * `sigilId` is the index dimension on both: Analytics Engine samples equitably
 * per index value, and per-app is the granularity every Insights read filters
 * on.
 *
 * `SigilIngestService` dual-writes into these alongside `sigilViewsHourly` /
 * `sigilVitalsHourly` — every read still goes through the legacy tables until
 * a later task switches them over.
 */
export class LoreAnalytics {
  public readonly views = $analytics({
    name: "sigil_views",
    index: "sigilId",
    dimensions: z.object({
      sigilId: z.string(),
      path: z.string(),
      country: z.string(),
    }),
    measures: z.object({ count: z.number() }),
    retention: { hot: "30d", rollup: "day", cold: "400d" },
  });

  /**
   * Web vitals as a histogram.
   *
   * `bucket` is an ordinary dimension rather than anything special: a
   * percentile cannot be merged across buckets but a histogram can, so the
   * bucket index is a grouping key and the count is the measure.
   */
  public readonly vitals = $analytics({
    name: "sigil_vitals",
    index: "sigilId",
    dimensions: z.object({
      sigilId: z.string(),
      metric: z.string(),
      path: z.string(),
      bucket: z.number(),
    }),
    measures: z.object({ samples: z.number() }),
    retention: { hot: "30d", rollup: "day", cold: "400d" },
  });
}
