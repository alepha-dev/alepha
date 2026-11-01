import type { ReportsQuery } from "@lore/core/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

export type ReportsGrain = NonNullable<ReportsQuery["grain"]>;

/**
 * One day's count, as `ProjectReportsService.completedByDay` returns it.
 */
export interface DailyCount {
  date: string;
  count: number;
}

/**
 * Turns the Reports daily counts into the series the flow tiles draw
 * (#Q2653): the arithmetic only, never a query, so every tile reads the same
 * rows Reports reads.
 *
 * Days are UTC `YYYY-MM-DD`, the shape `SqlExpressionProvider.dateDay`
 * produces.
 */
export class DashboardFlowSeries {
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * The last `days` days, oldest first, ending today.
   */
  days(days: number): string[] {
    const today = this.dateTime.nowMillis();
    return Array.from({ length: days }, (_, index) =>
      new Date(today - (days - 1 - index) * 86_400_000)
        .toISOString()
        .slice(0, 10),
    );
  }

  /**
   * One point per day of the window, zero-filled.
   */
  daily(
    rows: DailyCount[],
    days: number,
  ): Array<{ at: string; value: number }> {
    const byDay = new Map(rows.map((row) => [row.date, Number(row.count)]));
    return this.days(days).map((at) => ({ at, value: byDay.get(at) ?? 0 }));
  }

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
   * The last point of each bucket, for a cumulative series.
   */
  sampled<T extends { at: string }>(points: T[], grain: ReportsGrain): T[] {
    const last = new Map<string, T>();
    for (const point of points) {
      last.set(this.bucket(point.at, grain), point);
    }
    return [...last.values()];
  }

  /**
   * The running total at each day of the window, history before it included.
   */
  cumulative(
    rows: DailyCount[],
    days: number,
  ): Array<{ at: string; value: number }> {
    return this.cumulativeOver(rows, this.days(days));
  }

  /**
   * The running total at each day of `axis`, history before it included.
   */
  cumulativeOver(
    rows: DailyCount[],
    axis: string[],
  ): Array<{ at: string; value: number }> {
    if (axis.length === 0) {
      return [];
    }
    let running = rows
      .filter((row) => row.date < axis[0]!)
      .reduce((sum, row) => sum + Number(row.count), 0);
    const byDay = new Map(rows.map((row) => [row.date, Number(row.count)]));
    return axis.map((at) => {
      running += byDay.get(at) ?? 0;
      return { at, value: running };
    });
  }

  /**
   * The total over the last `days` days.
   */
  total(rows: DailyCount[], days: number): number {
    const first = this.days(days)[0]!;
    return rows
      .filter((row) => row.date >= first)
      .reduce((sum, row) => sum + Number(row.count), 0);
  }

  /**
   * One point per week, the last `weeks` weeks, oldest first: each week is
   * the seven days ending on its point's date.
   */
  weekly(
    rows: DailyCount[],
    weeks: number,
  ): Array<{ at: string; value: number }> {
    const axis = this.days(weeks * 7);
    const byDay = new Map(rows.map((row) => [row.date, Number(row.count)]));
    return Array.from({ length: weeks }, (_, week) => {
      const slice = axis.slice(week * 7, week * 7 + 7);
      return {
        at: slice[slice.length - 1]!,
        value: slice.reduce((sum, day) => sum + (byDay.get(day) ?? 0), 0),
      };
    });
  }
}
