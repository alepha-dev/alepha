import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { beforeEach, describe, expect, it } from "vitest";

import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

import { KanbanAging } from "./kanbanAging.ts";

describe("KanbanAging", () => {
  const aging = new KanbanAging();
  let dt: DateTimeProvider;

  beforeEach(() => {
    dt = Alepha.create().inject(DateTimeProvider);
    dt.pause();
  });

  const daysAgo = (days: number) =>
    dt.now().subtract(days, "day").toDate().toISOString();

  const quest = (options: {
    status?: string;
    acceptedAt?: string;
    createdAt?: string;
    history?: Array<{ at: string; action: string; column?: string }>;
  }): QuestResource =>
    ({
      id: 1,
      metadata: { status: options.status ?? "accepted" },
      acceptedAt: options.acceptedAt,
      createdAt: options.createdAt ?? daysAgo(0),
      history: options.history ?? [],
    }) as unknown as QuestResource;

  describe("thresholds", () => {
    it("is fresh just after arriving", () => {
      expect(aging.levelOf(quest({ acceptedAt: daysAgo(1) }), dt)).toBe(
        "fresh",
      );
    });

    it("is aging past a week", () => {
      expect(aging.levelOf(quest({ acceptedAt: daysAgo(8) }), dt)).toBe(
        "aging",
      );
    });

    it("is stale past three weeks", () => {
      expect(aging.levelOf(quest({ acceptedAt: daysAgo(30) }), dt)).toBe(
        "stale",
      );
    });
  });

  /**
   * The trap the quest called out: `updatedAt` is not the clock. These
   * assert the replacement actually behaves differently from it.
   */
  describe("the clock is the column, not the last edit", () => {
    it("measures from the last move, not from creation", () => {
      const q = quest({
        acceptedAt: daysAgo(60),
        history: [
          { at: daysAgo(60), action: "assigned" },
          { at: daysAgo(1), action: "moved", column: "Review" },
        ],
      });
      // Accepted two months ago, but it moved yesterday — it is not stalled.
      expect(aging.levelOf(q, dt)).toBe("fresh");
    });

    it("stays stale when the last move is old, however recent other events are", () => {
      const q = quest({
        acceptedAt: daysAgo(60),
        history: [
          { at: daysAgo(40), action: "moved", column: "Doing" },
          // Plenty of recent activity that is NOT a move: a card being
          // discussed is not a card making progress.
          { at: daysAgo(0), action: "objective_completed" },
          { at: daysAgo(0), action: "assigned" },
        ],
      });
      expect(aging.levelOf(q, dt)).toBe("stale");
    });

    it("falls back to acceptedAt for a card that predates move tracking", () => {
      const q = quest({ acceptedAt: daysAgo(30), history: [] });
      expect(aging.levelOf(q, dt)).toBe("stale");
    });
  });

  /**
   * Only work in flight can be neglected.
   */
  describe("which cards age at all", () => {
    it("never ages a new card", () => {
      expect(
        aging.levelOf(quest({ status: "new", createdAt: daysAgo(400) }), dt),
      ).toBe("fresh");
    });

    it("never ages a completed card", () => {
      expect(
        aging.levelOf(
          quest({ status: "completed", acceptedAt: daysAgo(400) }),
          dt,
        ),
      ).toBe("fresh");
    });
  });

  describe("under a moving clock", () => {
    it("crosses each threshold as time passes", async () => {
      const q = quest({ acceptedAt: daysAgo(0) });
      expect(aging.levelOf(q, dt)).toBe("fresh");

      await dt.travel(8, "day");
      expect(aging.levelOf(q, dt)).toBe("aging");

      await dt.travel(20, "day");
      expect(aging.levelOf(q, dt)).toBe("stale");
    });
  });
});
