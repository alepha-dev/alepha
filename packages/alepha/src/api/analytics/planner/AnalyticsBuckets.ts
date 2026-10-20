import { AlephaError } from "alepha";

import type {
  AnalyticsDataset,
  AnalyticsResolution,
} from "../schemas/analyticsDatasetSchema.ts";

/**
 * Bucket keys as strings, and the arithmetic over them.
 *
 * `YYYY-MM-DDTHH:MM` for sub-hour buckets (the minute floored to the
 * resolution), `YYYY-MM-DDTHH` for hours and `YYYY-MM-DD` for days, chosen so
 * a coarser key is a prefix of every finer one. Every "which day is this hour
 * in" question is then a substring rather than date arithmetic, on every
 * backend, and keys sort chronologically as plain strings, which is what lets
 * a time range be an indexed string range.
 *
 * Callers pass milliseconds obtained from `DateTimeProvider`; this class never
 * reads the clock itself, which is what keeps it a pure function and keeps
 * `travel()` meaningful in tests.
 */
export class AnalyticsBuckets {
  /**
   * Bucket resolutions a dataset may declare, in minutes.
   */
  public static readonly RESOLUTIONS: Record<AnalyticsResolution, number> = {
    "1m": 1,
    "5m": 5,
    "15m": 15,
    "1h": 60,
  };

  public static hour(millis: number): string {
    return new Date(millis).toISOString().slice(0, 13);
  }

  /**
   * The key of the bucket `millis` falls in, at `resolution`.
   */
  public static bucket(
    millis: number,
    resolution: AnalyticsResolution,
  ): string {
    const step = AnalyticsBuckets.minutesOf(resolution);
    if (step === 60) return AnalyticsBuckets.hour(millis);
    const iso = new Date(millis).toISOString();
    const minute = Math.floor(Number(iso.slice(14, 16)) / step) * step;
    return `${iso.slice(0, 13)}:${String(minute).padStart(2, "0")}`;
  }

  /**
   * The dataset's finest resolution, `"1h"` unless it declares one.
   */
  public static resolutionOf(dataset: AnalyticsDataset): AnalyticsResolution {
    return dataset.resolution ?? "1h";
  }

  public static minutesOf(resolution: AnalyticsResolution): number {
    const minutes = AnalyticsBuckets.RESOLUTIONS[resolution];
    if (!minutes) {
      throw new AlephaError(
        `Received an unknown resolution '${resolution}'; expected one of ${Object.keys(AnalyticsBuckets.RESOLUTIONS).join(", ")}.`,
      );
    }
    return minutes;
  }

  /**
   * Whether `key` is a well-formed bucket at `resolution`: the right shape,
   * and on a sub-hour resolution a minute that is a multiple of the step.
   */
  public static isBucket(
    key: string,
    resolution: AnalyticsResolution,
  ): boolean {
    const step = AnalyticsBuckets.minutesOf(resolution);
    if (step === 60) return /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(key);
    const match = /^\d{4}-\d{2}-\d{2}T\d{2}:(\d{2})$/.exec(key);
    return !!match && Number(match[1]) < 60 && Number(match[1]) % step === 0;
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
