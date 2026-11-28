/**
 * How long one visitor hash lives: a UTC calendar month, an ISO week or a
 * UTC day. `SIGIL_SALT_ROTATION` picks it; a month is the default.
 */
export type SigilSaltRotation = "month" | "week" | "day";

/**
 * The period an instant falls in, at `rotation`, all UTC: `2026-11`,
 * `2026-W48` (the ISO week and its ISO year) or `2026-11-25`.
 *
 * The proxy salts the visitor hash with this string and stamps it on the
 * envelope, so the sink knows which period a hash belongs to: the same
 * person gives the same hash all period long and a different one in the
 * next, and no hash outlives its period.
 */
export const sigilVisitorPeriod = (
  millis: number,
  rotation: SigilSaltRotation = "month",
): string => {
  const iso = new Date(millis).toISOString();
  if (rotation === "day") return iso.slice(0, 10);
  if (rotation === "month") return iso.slice(0, 7);
  // ISO 8601: the week belongs to the year of its Thursday.
  const day = Date.parse(`${iso.slice(0, 10)}T00:00:00.000Z`);
  const weekday = (new Date(day).getUTCDay() + 6) % 7; // Monday is 0
  const thursday = new Date(day + (3 - weekday) * 86_400_000);
  const year = thursday.getUTCFullYear();
  const january1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - january1) / 86_400_000 / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
};

/**
 * Which rotation a period string is of, or `undefined` when it is of no
 * known shape.
 */
export const sigilVisitorPeriodRotation = (
  period: string,
): SigilSaltRotation | undefined => {
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return "month";
  if (/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(period)) return "week";
  if (/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(period)) {
    return "day";
  }
  return undefined;
};

/**
 * The instant a period starts, UTC millis, or `undefined` for a string of
 * no known shape.
 */
export const sigilVisitorPeriodStart = (period: string): number | undefined => {
  const rotation = sigilVisitorPeriodRotation(period);
  if (rotation === "month") return Date.parse(`${period}-01T00:00:00.000Z`);
  if (rotation === "day") {
    const start = Date.parse(`${period}T00:00:00.000Z`);
    return Number.isNaN(start) ||
      new Date(start).toISOString().slice(0, 10) !== period
      ? undefined
      : start;
  }
  if (rotation === "week") {
    const year = Number(period.slice(0, 4));
    const week = Number(period.slice(6));
    // ISO week 1 is the one holding January 4th.
    const january4 = Date.UTC(year, 0, 4);
    const weekday = (new Date(january4).getUTCDay() + 6) % 7;
    const start = january4 - weekday * 86_400_000 + (week - 1) * 7 * 86_400_000;
    return sigilVisitorPeriod(start, "week") === period ? start : undefined;
  }
  return undefined;
};

/**
 * The instant a period ends (the next one's start), UTC millis.
 */
export const sigilVisitorPeriodEnd = (period: string): number | undefined => {
  const start = sigilVisitorPeriodStart(period);
  const rotation = sigilVisitorPeriodRotation(period);
  if (start === undefined || rotation === undefined) return undefined;
  if (rotation === "day") return start + 86_400_000;
  if (rotation === "week") return start + 7 * 86_400_000;
  const date = new Date(start);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
};

/**
 * How long after a period ends a sender may still name it: a batch is held
 * for seconds by the browser and the app's server, and retried when the
 * sink is down. Six hours, the same as the oldest event time an ingest
 * believes. A sink erases a period's hashes only once this has passed too,
 * so a late batch never finds its session's hash gone and opens a second
 * one.
 */
export const SIGIL_VISITOR_PERIOD_GRACE_MS = 6 * 60 * 60 * 1000;

/**
 * Whether a sink should believe a sender's `visitorPeriod` at `now`: a known
 * shape naming the current period of its rotation, or the one just before
 * within {@link SIGIL_VISITOR_PERIOD_GRACE_MS} of its end.
 *
 * The previous one is allowed because the last views of a period routinely
 * arrive just after it ends. Anything else
 * (a malformed value, a future period, an old one) is a sender writing
 * sessions into a period it is not in, and is treated as absent.
 */
export const sigilVisitorPeriodAccepted = (
  period: string | undefined,
  now: number,
): period is string => {
  if (!period) return false;
  const rotation = sigilVisitorPeriodRotation(period);
  if (!rotation || sigilVisitorPeriodStart(period) === undefined) return false;
  const current = sigilVisitorPeriod(now, rotation);
  if (period === current) return true;
  const currentStart = sigilVisitorPeriodStart(current) as number;
  return (
    now - currentStart <= SIGIL_VISITOR_PERIOD_GRACE_MS &&
    period === sigilVisitorPeriod(currentStart - 1, rotation)
  );
};
