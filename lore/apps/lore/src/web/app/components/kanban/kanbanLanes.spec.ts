import { describe, expect, it } from "vitest";

import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

import { KanbanLanes, UNGROUPED } from "./kanbanLanes.ts";

const quest = (
  id: number,
  options: { area?: string; epicId?: number } = {},
): QuestResource =>
  ({
    id,
    shortId: id,
    area: options.area ?? "core",
    epicId: options.epicId,
  }) as unknown as QuestResource;

describe("KanbanLanes", () => {
  const lanes = new KanbanLanes();

  describe("no grouping", () => {
    it("returns one nameless lane holding everything", () => {
      const out = lanes.build([quest(1), quest(2)], "none");
      expect(out).toHaveLength(1);
      expect(out[0].key).toBe("");
      expect(out[0].quests.map((q) => q.id)).toEqual([1, 2]);
    });
  });

  describe("by area", () => {
    it("makes one lane per area", () => {
      const out = lanes.build(
        [
          quest(1, { area: "core" }),
          quest(2, { area: "ui" }),
          quest(3, { area: "core" }),
        ],
        "area",
      );
      expect(out.map((l) => l.label)).toEqual(["core", "ui"]);
      expect(out[0].quests.map((q) => q.id)).toEqual([1, 3]);
    });

    it("orders lanes by where their first card appears, not alphabetically", () => {
      const out = lanes.build(
        [quest(1, { area: "zulu" }), quest(2, { area: "alpha" })],
        "area",
      );
      expect(out.map((l) => l.label)).toEqual(["zulu", "alpha"]);
    });

    it("carries the area name so the lane can show its colour", () => {
      const out = lanes.build([quest(1, { area: "core" })], "area");
      expect(out[0].areaName).toBe("core");
    });
  });

  describe("by epic", () => {
    it("labels a lane with the epic title when it can resolve one", () => {
      const out = lanes.build(
        [quest(1, { epicId: 7 })],
        "epic",
        new Map([[7, "Kanban v2"]]),
      );
      expect(out[0].label).toBe("Kanban v2");
    });

    it("still makes a lane for an epic it cannot resolve", () => {
      // A card must never disappear because a lookup failed.
      const out = lanes.build([quest(1, { epicId: 7 })], "epic", new Map());
      expect(out).toHaveLength(1);
      expect(out[0].quests.map((q) => q.id)).toEqual([1]);
      expect(out[0].label).toContain("7");
    });
  });

  /**
   * "Has no epic" is not a grouping anyone is looking for, so it goes last
   * however early its first card appears.
   */
  describe("the leftover lane", () => {
    it("sorts last even when its first card is first", () => {
      const out = lanes.build(
        [quest(1), quest(2, { epicId: 3 })],
        "epic",
        new Map([[3, "Real epic"]]),
      );
      expect(out.map((l) => l.label)).toEqual(["Real epic", UNGROUPED]);
    });

    it("keeps every quest across all lanes", () => {
      const input = [
        quest(1),
        quest(2, { epicId: 3 }),
        quest(3, { epicId: 4 }),
        quest(4),
      ];
      const out = lanes.build(input, "epic", new Map());
      expect(
        out
          .flatMap((l) => l.quests)
          .map((q) => q.id)
          .sort((a, b) => a - b),
      ).toEqual([1, 2, 3, 4]);
    });
  });
});
