import { AlephaError } from "alepha";

/**
 * Bucket keys as strings, and the arithmetic over them.
 *
 * `YYYY-MM-DDTHH` for hours and `YYYY-MM-DD` for days, chosen so the day is a
 * prefix of the hour. Every "which day is this hour in" question is then a
 * substring rather than date arithmetic, on every backend, and the storage
 * stays hourly while the chart asks for days.
 *
 * Callers pass milliseconds obtained from `DateTimeProvider`; this class never
 * reads the clock itself, which is what keeps it a pure function and keeps
 * `travel()` meaningful in tests.
 */
export class AnalyticsBuckets {
  public static hour(millis: number): string {
    return new Date(millis).toISOString().slice(0, 13);
  }

  public static day(bucket: string): string {
    return bucket.slice(0, 10);
  }

  /**
   * Parses a `<n>d` retention spec into milliseconds.
   *
   * Days only, deliberately: the rollup granularity is a day, so an hour-level
   * retention window would express a boundary the storage cannot honour.
   */
  public static parseWindow(spec: string): number {
    const match = /^(\d+)d$/.exec(spec);
    if (!match) {
      throw new AlephaError(
        `Received a malformed retention window '${spec}'; expected a day count such as '60d'.`,
      );
    }
    return Number(match[1]) * 24 * 60 * 60 * 1000;
  }

  public static shiftDays(bucket: string, days: number): string {
    const base = Date.parse(`${AnalyticsBuckets.day(bucket)}T00:00:00.000Z`);
    return new Date(base + days * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }
}
