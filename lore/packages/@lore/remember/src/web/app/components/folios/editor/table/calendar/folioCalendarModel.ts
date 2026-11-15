import type { FolioRowResource } from "../../../../../../../api/schemas/folioRowResourceSchema.ts";

/**
 * The calendar's pure half (#E144, #Q3518): which days a month shows, which
 * day a row falls on, and what a dated value becomes when it moves.
 *
 * A day is a key, `YYYY-MM-DD`. A day-only cell IS its key and never shifts
 * with the reader's zone; a timed cell (an ISO instant) falls on the day it
 * is in the reader's zone.
 */

/**
 * The first day of the week for a locale: 1 Monday … 7 Sunday, from
 * `Intl.Locale`'s week info where the runtime has it, else Sunday for the
 * locales that start there and Monday for the rest.
 */
export const folioWeekStart = (locale: string): number => {
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const first = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    if (first) return first;
  } catch {
    // An unknown tag reads as the default below.
  }
  return /^(en-US|en-CA|ja|ko|zh|he|pt-BR)$/i.test(locale) ||
    locale.toLowerCase() === "en"
    ? 7
    : 1;
};

/**
 * `YYYY-MM-DD` of a date's calendar day, in the local zone.
 */
export const folioDayKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/**
 * The day a cell falls on for the reader, or `undefined` for an empty or
 * unreadable one.
 */
export const folioCellDay = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? undefined : folioDayKey(at);
};

/**
 * The weeks a month shows: whole weeks from the one holding the 1st to the
 * one holding the last day, each a list of seven day keys.
 */
export const folioMonthWeeks = (
  month: string,
  weekStart: number,
): string[][] => {
  const [year, m] = month.split("-").map(Number);
  const first = new Date(year, m - 1, 1);
  const last = new Date(year, m, 0);
  // getDay: 0 Sunday … 6 Saturday; weekStart: 1 Monday … 7 Sunday.
  const offset = (first.getDay() - (weekStart % 7) + 7) % 7;
  const count = Math.ceil((offset + last.getDate()) / 7);
  const cursor = new Date(year, m - 1, 1 - offset);
  const weeks: string[][] = [];
  for (let w = 0; w < count; w += 1) {
    const week: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push(folioDayKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
};

/**
 * `YYYY-MM` of the month before or after.
 */
export const folioShiftMonth = (month: string, by: number): string => {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(year, m - 1 + by, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * The rows of each day, in time order (a day-only row before the timed rows
 * of its day), and the rows with no date.
 */
export const folioRowsByDay = (
  rows: FolioRowResource[],
  dateColumnId: string,
): { byDay: Map<string, FolioRowResource[]>; undated: FolioRowResource[] } => {
  const byDay = new Map<string, FolioRowResource[]>();
  const undated: FolioRowResource[] = [];
  for (const row of rows) {
    const day = folioCellDay(row.cells[dateColumnId]);
    if (!day) {
      undated.push(row);
      continue;
    }
    byDay.set(day, [...(byDay.get(day) ?? []), row]);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => {
      const left = String(a.cells[dateColumnId]);
      const right = String(b.cells[dateColumnId]);
      return left < right ? -1 : left > right ? 1 : a.position - b.position;
    });
  }
  return { byDay, undated };
};

/**
 * A dated value moved to another day: a day-only value becomes that day; a
 * timed one keeps its time of day in the reader's zone.
 */
export const folioMoveToDay = (value: unknown, day: string): string => {
  if (typeof value !== "string" || /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return day;
  }
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return day;
  const [year, month, date] = day.split("-").map(Number);
  const moved = new Date(at);
  moved.setFullYear(year, month - 1, date);
  return moved.toISOString();
};

/**
 * The time of a timed cell in the reader's zone (`14:30`), or nothing for a
 * day-only one.
 */
export const folioCellTime = (
  value: unknown,
  locale?: string,
): string | undefined => {
  if (typeof value !== "string" || value.length === 10) return undefined;
  const at = new Date(value);
  return Number.isNaN(at.getTime())
    ? undefined
    : at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
};
