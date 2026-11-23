import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

/**
 * The day arithmetic the visitors numbers share: which day is the last
 * complete one, and when a percent change may be shown at all.
 *
 * A whole day, never today-so-far. `getInsights` anchored on today until
 * quest #1245, and `range: "1d"` therefore meant *today so far* - a partial
 * day measured against a complete one reads as a collapse every morning and
 * recovers by dinner, so the number moved because the clock moved.
 *
 * {@link percentChange} is the single definition of an honest delta: the
 * dashboard tile (`UniqueVisitorsMetric`) and `InsightsController` both use
 * it rather than keeping a copy each.
 */
export class DailyVisitorsService {
  protected readonly dateTime = $inject(DateTimeProvider);

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
