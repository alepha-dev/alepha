/**
 * A window of whole UTC days ending with today, and the window of the same
 * length just before it, as calendar days (`YYYY-MM-DD`).
 *
 * Whole days because the lists the dashboard's tiles open filter by day: the
 * audit log's date filter takes a range of days and reads it in UTC
 * (`AdminAudits`), so a tile counting a rolling 168 hours would never match
 * the list behind it.
 */
export interface AdminDashboardDayWindow {
  /**
   * First day of the window, `days - 1` days before today.
   */
  from: string;
  /**
   * Last day of the window: today, in UTC.
   */
  to: string;
  previousFrom: string;
  previousTo: string;
}

const DAY = 86_400_000;

const isoDay = (millis: number): string =>
  new Date(millis).toISOString().slice(0, 10);

/**
 * The window of `days` whole UTC days ending today, and the one before it.
 * `nowMillis` comes from `DateTimeProvider`, so a spec can pin the clock.
 */
export const adminDashboardDayWindow = (
  nowMillis: number,
  days: number,
): AdminDashboardDayWindow => {
  const today = Math.floor(nowMillis / DAY) * DAY;
  return {
    from: isoDay(today - (days - 1) * DAY),
    to: isoDay(today),
    previousFrom: isoDay(today - (2 * days - 1) * DAY),
    previousTo: isoDay(today - days * DAY),
  };
};

/**
 * A closed range of days as the audit query's instants, the exact mapping
 * `AdminAudits` applies to its date filter: first millisecond of the first
 * day to the last millisecond of the last, in UTC. Shared so a tile and the
 * list it opens cannot drift apart.
 */
export const adminAuditDayRange = (
  fromDay: string,
  toDay: string,
): { from: string; to: string } => ({
  from: `${fromDay}T00:00:00.000Z`,
  to: `${toDay}T23:59:59.999Z`,
});
