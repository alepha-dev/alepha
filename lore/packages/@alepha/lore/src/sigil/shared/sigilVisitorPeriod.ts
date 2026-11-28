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
