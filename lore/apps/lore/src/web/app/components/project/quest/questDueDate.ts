import type { DateTimeProvider } from "alepha/datetime";

export interface QuestDueState {
  /**
   * The deadline has passed.
   */
  overdue: boolean;
  /**
   * Close enough, in either direction, for a weekday name to be
   * unambiguous.
   */
  withinAWeek: boolean;
  /**
   * The dayjs format to localize the date with — a weekday while it is
   * close, a real date once it is not.
   */
  dateFormat: "dddd" | "ll";
}

/**
 * The due-date rule, shared by every surface that shows one.
 *
 * Extracted when the board card became the second renderer: the quest page
 * had the rule inline, and a card that computed "overdue" its own way would
 * eventually disagree with the page about the same quest — the kind of
 * divergence nobody notices until a deadline is wrong on one screen.
 *
 * ⚠️ Takes `DateTimeProvider` rather than reading the clock. `Date.now()`
 * is banned repo-wide precisely so `travel()` / `pause()` can drive this in
 * tests, and "is it overdue" is exactly the kind of assertion that needs a
 * pinned clock.
 */
export class QuestDueDate {
  describe(dueAt: string, dt: DateTimeProvider): QuestDueState {
    const due = dt.of(dueAt);
    const now = dt.now();
    // Both directions: a negative diff (overdue) counts as "within a week"
    // only when it is less than a week ago, or a three-month-old deadline
    // would read as "Due Monday".
    const withinAWeek = Math.abs(due.diff(now, "day")) < 7;
    return {
      overdue: due.isBefore(now),
      withinAWeek,
      dateFormat: withinAWeek ? "dddd" : "ll",
    };
  }
}
