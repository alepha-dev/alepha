/**
 * A date-only value (`YYYY-MM-DD`) names a calendar DAY, not an instant, so
 * it is parsed and formatted in local parts.
 *
 * ⚠️ This is not a stylistic preference. `new Date("2026-08-23")` is UTC
 * midnight, which displays as the 22nd west of Greenwich, and
 * `toISOString()` on a local midnight stores the previous day east of it. A
 * control that mixes the two shifts every value it renders by a day for half
 * the world.
 *
 * Extracted so `ControlDate` and `ControlDateRange` share one answer: two
 * copies of this reasoning is two chances to get the timezone wrong, and the
 * one that drifts is the one nobody is looking at.
 */
export const parseDateOnly = (value: string): Date => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};

export const formatDateOnly = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
