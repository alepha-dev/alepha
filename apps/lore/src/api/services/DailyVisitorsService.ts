import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import { LoreAnalyticsStore } from "./LoreAnalyticsStore.ts";

/**
 * One complete UTC day of audience, and the one before it.
 */
export interface DailyVisitors {
  /**
   * The day measured, `YYYY-MM-DD`.
   */
  day: string;
  uniqueVisitors: number;
  /**
   * The preceding day, `YYYY-MM-DD`.
   */
  previousDay: string;
  previousUniqueVisitors: number;
  /**
   * Percent change, or `undefined` when there is nothing honest to say —
   * see {@link percentChange}.
   */
  delta?: number;
}

/**
 * "How many people came yesterday, and was that more than the day before."
 *
 * A whole day, never today-so-far. `getInsights` anchored on today until
 * quest #1245, and `range: "1d"` therefore meant *today so far* — a partial
 * day measured against a complete one reads as a collapse every morning and
 * recovers by dinner, so the number moved because the clock moved.
 *
 * Separate from `InsightsController` on purpose. That endpoint answers a
 * page: ten segments, ten queries, and its cost grows with the analytics
 * page's feature set. A dashboard tile needs one number and a delta, and it
 * must not inherit that cost — the whole dashboard is one request precisely
 * so that ten tiles are not ten page payloads.
 *
 * What the two DO share is the rule for when a delta may be shown at all:
 * {@link percentChange} is the single definition, and `InsightsController`
 * uses this one rather than keeping a second copy.
 */
export class DailyVisitorsService {
  protected readonly analytics = $inject(LoreAnalyticsStore);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Yesterday and the day before, for a set of apps.
   *
   * One number per window rather than a per-app breakdown: the same person
   * visiting two of a project's apps on one day is one visitor, and only the
   * store can know that — summing per-app counts would over-report.
   */
  async read(sigilIds: string[]): Promise<DailyVisitors> {
    const day = this.lastCompleteDay();
    const previousDay = this.shift(day, -1);

    if (sigilIds.length === 0) {
      return {
        day,
        uniqueVisitors: 0,
        previousDay,
        previousUniqueVisitors: 0,
      };
    }

    const [uniqueVisitors, previousUniqueVisitors] = await Promise.all([
      this.analytics.uniqueVisitors({ sigilIds, since: day, until: day }),
      this.analytics.uniqueVisitors({
        sigilIds,
        since: previousDay,
        until: previousDay,
      }),
    ]);

    return {
      day,
      uniqueVisitors,
      previousDay,
      previousUniqueVisitors,
      delta: this.percentChange(previousUniqueVisitors, uniqueVisitors),
    };
  }

  /**
   * Percent change from `before` to `after`, rounded to a whole percent.
   *
   * `undefined` when there is nothing honest to say: no baseline was
   * measured, or it was zero — where the change is undefined rather than
   * infinite, and rendering it as `+0%` or `+100%` would both be inventions.
   * A UI must render the absence as "no comparison".
   */
  percentChange(before: number | undefined, after: number): number | undefined {
    if (before === undefined || before === 0) {
      return undefined;
    }
    return Math.round(((after - before) / before) * 100);
  }

  /**
   * Yesterday, UTC. The most recent day that is over.
   */
  lastCompleteDay(): string {
    return this.shift(
      new Date(this.dateTime.nowMillis()).toISOString().slice(0, 10),
      -1,
    );
  }

  /**
   * `YYYY-MM-DD` shifted by whole days, UTC.
   */
  protected shift(day: string, days: number): string {
    const at = Date.parse(`${day}T00:00:00.000Z`) + days * 24 * 60 * 60 * 1000;
    return new Date(at).toISOString().slice(0, 10);
  }
}
