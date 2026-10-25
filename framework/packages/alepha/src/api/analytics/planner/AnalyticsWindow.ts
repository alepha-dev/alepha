import { AlephaError } from "alepha";

import type { AnalyticsTierResolution } from "../schemas/analyticsDatasetSchema.ts";
import type { AnalyticsQuery } from "../schemas/analyticsQuerySchema.ts";
import { AnalyticsBuckets } from "./AnalyticsBuckets.ts";

/**
 * The bucket keys one tier reads for a query: `time_bucket >= lower` and,
 * when bounded above, `time_bucket < upper`. `straddling` lists the buckets
 * read whole although they extend outside the instants asked for.
 */
export interface AnalyticsTierBounds {
  lower: string;
  upper?: string;
  straddling: string[];
}

/**
 * A query's time window, turned into key ranges per tier.
 *
 * Two forms, exactly one per query. `since`/`until` are whole UTC days,
 * inclusive. `from`/`to` are ISO 8601 instants with an offset
 * (`2026-10-18T08:00:00+04:00`), `to` exclusive so consecutive windows never
 * count a bucket twice. An instant without an offset is refused: the server
 * never guesses a timezone.
 *
 * Instants floor (`from`) and ceil (`to`) to each tier's resolution. A
 * bucket that straddles a bound is read **whole** rather than dropped,
 * because dropping it would silently lose readings the window asked for; it
 * is reported in `straddling`, which is what `coarsened` on the result is
 * built from.
 */
export class AnalyticsWindow {
  /**
   * An instant with a mandatory offset: `Z` or `+HH:MM` / `-HH:MM`.
   */
  public static readonly INSTANT =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

  /**
   * Refuses a query naming both forms, neither, a bound of the other form,
   * or an instant without an offset.
   */
  public static assertValid(query: AnalyticsQuery): void {
    const hasSince = query.since !== undefined;
    const hasFrom = query.from !== undefined;
    if (hasSince === hasFrom) {
      throw new AlephaError(
        "An analytics query takes exactly one of 'since' (whole UTC days) or 'from' (an instant with an offset).",
      );
    }
    if (hasSince && query.to !== undefined) {
      throw new AlephaError(
        "'to' pairs with 'from', not with 'since'; use 'until' for a day.",
      );
    }
    if (hasFrom && query.until !== undefined) {
      throw new AlephaError(
        "'until' pairs with 'since', not with 'from'; use 'to' for an instant.",
      );
    }
    for (const [name, value] of [
      ["from", query.from],
      ["to", query.to],
    ] as const) {
      if (value === undefined) continue;
      if (
        !AnalyticsWindow.INSTANT.test(value) ||
        Number.isNaN(Date.parse(value))
      ) {
        throw new AlephaError(
          `'${name}' must be an ISO 8601 instant with an offset, such as '2026-10-18T08:00:00+04:00' or '2026-10-18T04:00:00Z'; received '${value}'.`,
        );
      }
    }
  }

  /**
   * The key range a tier at `resolution` reads for `query`.
   */
  public static forTier(
    query: AnalyticsQuery,
    resolution: AnalyticsTierResolution,
  ): AnalyticsTierBounds {
    AnalyticsWindow.assertValid(query);

    if (query.from === undefined) {
      // A day is a prefix of every finer key, so the same bounds serve every
      // tier, and the inclusive `until` becomes "before the next day".
      return {
        lower: query.since as string,
        upper:
          query.until === undefined
            ? undefined
            : AnalyticsBuckets.shiftDays(query.until, 1),
        straddling: [],
      };
    }

    const step = AnalyticsBuckets.minutesOf(resolution) * 60_000;
    const straddling: string[] = [];

    const from = Date.parse(query.from);
    const lower = AnalyticsBuckets.bucket(from, resolution);
    if (AnalyticsBuckets.startOf(lower) < from) straddling.push(lower);

    if (query.to === undefined) return { lower, straddling };

    const to = Date.parse(query.to);
    const last = AnalyticsBuckets.bucket(to - 1, resolution);
    const upper = AnalyticsBuckets.bucket(
      AnalyticsBuckets.startOf(last) + step,
      resolution,
    );
    if (to <= from) return { lower, upper: lower, straddling: [] };
    if (AnalyticsBuckets.startOf(upper) > to && !straddling.includes(last)) {
      straddling.push(last);
    }
    return { lower, upper, straddling };
  }
}
