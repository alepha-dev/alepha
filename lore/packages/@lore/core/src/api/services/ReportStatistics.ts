import type { ReportsQuery } from "../schemas/reportsQuerySchema.ts";

export type ReportsGrain = NonNullable<ReportsQuery["grain"]>;

/**
 * The order statistics every report reads time-shaped figures through
 * (#E108): medians and p85, never means, since one old quest skews a mean and
 * cannot move a median.
 *
 * Folded in memory on purpose: neither SQLite nor D1 has `percentile_cont`, and
 * a window function per figure would still read every row these do.
 */
export class ReportStatistics {
  /**
   * Every calendar day from `from` to `to`, both included. Takes dates or
   * timestamps and answers UTC `YYYY-MM-DD`.
   */
  between(from: string, to: string): string[] {
    const last = Date.parse(to.slice(0, 10));
    const days: string[] = [];
    for (let at = Date.parse(from.slice(0, 10)); at <= last; at += 86_400_000) {
      days.push(new Date(at).toISOString().slice(0, 10));
    }
    return days;
  }

  /**
   * The grain an axis of this many days reads best at, when nobody chose one.
   */
  grainFor(days: number): ReportsGrain {
    return days <= 92 ? "day" : days <= 400 ? "week" : "month";
  }

  /**
   * The first day of the bucket holding `day`: itself, its Monday, or the
   * first of its month.
   */
  bucket(day: string, grain: ReportsGrain): string {
    if (grain === "month") {
      return `${day.slice(0, 7)}-01`;
    }
    if (grain === "day") {
      return day;
    }
    const at = new Date(day);
    const sinceMonday = (at.getUTCDay() + 6) % 7;
    return new Date(at.getTime() - sinceMonday * 86_400_000)
      .toISOString()
      .slice(0, 10);
  }

  /**
   * The value at percentile `p` (0-100) of `values`, nearest rank: always a
   * value that was measured. Zero for no values, which a caller shows as "no
   * data" rather than as a figure.
   */
  percentile(values: readonly number[], p: number): number {
    if (values.length === 0) {
      return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.max(rank - 1, 0)]!;
  }

  /**
   * The middle value, the mean of the two middle ones for an even count.
   */
  median(values: readonly number[]): number {
    if (values.length === 0) {
      return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[middle]!
      : (sorted[middle - 1]! + sorted[middle]!) / 2;
  }
}
