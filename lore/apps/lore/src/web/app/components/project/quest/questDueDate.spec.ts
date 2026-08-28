import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { beforeEach, describe, expect, it } from "vitest";

import { QuestDueDate } from "./questDueDate.ts";

describe("QuestDueDate", () => {
  const rule = new QuestDueDate();
  let dt: DateTimeProvider;

  beforeEach(() => {
    dt = Alepha.create().inject(DateTimeProvider);
    // Frozen rather than pinned to a literal date: `pause()` takes no
    // argument, and every case below is expressed as an offset from "now"
    // anyway, so the assertions never depend on the wall clock.
    dt.pause();
  });

  /**
   * Offsets from the frozen clock, as the ISO strings `quests.dueAt` holds.
   */
  const inDays = (days: number) =>
    dt.now().add(days, "day").toDate().toISOString();

  describe("overdue", () => {
    it("is false for a deadline in the future", () => {
      expect(rule.describe(inDays(1), dt).overdue).toBe(false);
    });

    it("is true for a deadline in the past", () => {
      expect(rule.describe(inDays(-1), dt).overdue).toBe(true);
    });
  });

  /**
   * The window is symmetric on purpose: a three-month-old deadline must not
   * read as "Due Monday", which is what an unsigned comparison would give.
   */
  describe("the weekday window", () => {
    it("uses a weekday for a date a few days ahead", () => {
      const state = rule.describe(inDays(3), dt);
      expect(state.withinAWeek).toBe(true);
      expect(state.dateFormat).toBe("dddd");
    });

    it("uses a weekday for a date a few days behind", () => {
      const state = rule.describe(inDays(-3), dt);
      expect(state.withinAWeek).toBe(true);
      expect(state.dateFormat).toBe("dddd");
    });

    it("uses a real date beyond a week ahead", () => {
      const state = rule.describe(inDays(20), dt);
      expect(state.withinAWeek).toBe(false);
      expect(state.dateFormat).toBe("ll");
    });

    it("uses a real date beyond a week behind", () => {
      const state = rule.describe(inDays(-90), dt);
      expect(state.withinAWeek).toBe(false);
      expect(state.dateFormat).toBe("ll");
      expect(state.overdue).toBe(true);
    });
  });

  /**
   * The clock moving is what flips a quest from due-soon to overdue, and it
   * is the only thing that should.
   */
  describe("under a moving clock", () => {
    it("becomes overdue once the deadline passes", async () => {
      const due = inDays(2);
      expect(rule.describe(due, dt).overdue).toBe(false);

      await dt.travel(3, "day");
      expect(rule.describe(due, dt).overdue).toBe(true);
    });

    it("falls out of the weekday window as it recedes", async () => {
      const due = inDays(1);
      expect(rule.describe(due, dt).withinAWeek).toBe(true);

      await dt.travel(30, "day");
      expect(rule.describe(due, dt).withinAWeek).toBe(false);
    });
  });
});
