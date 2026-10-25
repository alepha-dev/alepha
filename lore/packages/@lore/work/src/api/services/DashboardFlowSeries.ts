import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

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
   * The running total at each day of the window, history before it included.
   */
  cumulative(
    rows: DailyCount[],
    days: number,
  ): Array<{ at: string; value: number }> {
    const axis = this.days(days);
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
