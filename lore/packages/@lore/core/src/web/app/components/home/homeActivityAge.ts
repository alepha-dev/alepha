import type { DateTimeProvider } from "alepha/datetime";

/**
 * From how many days without any activity a project reads as inactive on
 * Home: its momentum and last activity turn muted.
 *
 * A week, the same window the momentum's change compares: a project nobody
 * touched this week is the one to push out of the eye's way, while one
 * touched a few days ago still reads as live.
 */
export const HOME_INACTIVE_AFTER_DAYS = 7;

/**
 * Whole calendar days between `at` and today, in the reader's timezone: 0 for
 * anything today, 1 for yesterday. Calendar days rather than 24-hour spans,
 * so something from late last night reads as "1d ago", not "today".
 */
export const activityAgeInDays = (dt: DateTimeProvider, at: string): number =>
  dt.now().startOf("day").diff(dt.of(at).startOf("day"), "day");
