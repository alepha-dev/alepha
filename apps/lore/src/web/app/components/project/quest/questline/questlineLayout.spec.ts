import { describe, expect, it } from "vitest";

import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

import {
  CARD_H,
  CARD_W,
  COL_GAP,
  QuestlineLayout,
  ROW_GAP,
} from "./questlineLayout.ts";

type Status = QuestResource["metadata"]["status"];

/**
 * Only the columns the layout actually reads. The cast keeps the fixtures
 * to four fields instead of forcing every spec to spell out a whole quest.
 */
const quest = (
  id: number,
  options: { dependsOn?: number; status?: Status } = {},
): QuestResource =>
  ({
    id,
    shortId: id,
    title: `Quest ${id}`,
    dependsOn: options.dependsOn,
    metadata: { status: options.status ?? "new" },
  }) as unknown as QuestResource;

describe("QuestlineLayout", () => {
  const layout = new QuestlineLayout();

  describe("shape", () => {
    it("puts every quest of a linear chain on one row", () => {
      const tracks = layout.build([
        quest(1),
        quest(2, { dependsOn: 1 }),
        quest(3, { dependsOn: 2 }),
      ]);

      expect(tracks).toHaveLength(1);
      expect(tracks[0]!.nodes.map((n) => n.quest.id)).toEqual([1, 2, 3]);
      expect(tracks[0]!.nodes.map((n) => n.y)).toEqual([0, 0, 0]);
      expect(tracks[0]!.nodes.map((n) => n.depth)).toEqual([0, 1, 2]);
      expect(tracks[0]!.height).toBe(CARD_H);
      expect(tracks[0]!.width).toBe(3 * CARD_W + 2 * COL_GAP);
    });

    it("gives an independent quest a questline of its own", () => {
      const tracks = layout.build([quest(1), quest(2), quest(3)]);

      expect(tracks).toHaveLength(3);
      expect(tracks.every((t) => t.nodes.length === 1)).toBe(true);
      expect(tracks.every((t) => t.edges.length === 0)).toBe(true);
    });

    it("stacks a fork's children and centres the parent between them", () => {
      const tracks = layout.build([
        quest(1),
        quest(2, { dependsOn: 1 }),
        quest(3, { dependsOn: 1 }),
      ]);

      const [root, first, second] = tracks[0]!.nodes;
      expect(first!.y).toBe(0);
      expect(second!.y).toBe(CARD_H + ROW_GAP);
      // Centred means equidistant, which is what makes the elbow symmetric.
      expect(second!.y - root!.y).toBe(root!.y - first!.y);
      expect(tracks[0]!.height).toBe(2 * CARD_H + ROW_GAP);
    });

    it("orders questlines deepest first, then by root shortId", () => {
      const tracks = layout.build([
        quest(9),
        quest(1),
        quest(2, { dependsOn: 1 }),
        quest(5),
      ]);

      expect(tracks.map((t) => t.rootId)).toEqual([1, 5, 9]);
    });
  });

  describe("edges", () => {
    it("draws one straight line per single dependent", () => {
      const tracks = layout.build([quest(1), quest(2, { dependsOn: 1 })]);

      expect(tracks[0]!.edges).toHaveLength(1);
      expect(tracks[0]!.edges[0]).toMatch(/^M\d+ \d+ H\d+$/);
    });

    it("turns a corner and fans out when a quest has two dependents", () => {
      const tracks = layout.build([
        quest(1),
        quest(2, { dependsOn: 1 }),
        quest(3, { dependsOn: 1 }),
      ]);

      // in to the elbow, down the spine, then out to each child
      expect(tracks[0]!.edges).toHaveLength(4);
      expect(tracks[0]!.edges.filter((d) => d.includes("V"))).toHaveLength(1);
    });

    it("lands the vertical span exactly on the two child centres", () => {
      const tracks = layout.build([
        quest(1),
        quest(2, { dependsOn: 1 }),
        quest(3, { dependsOn: 1 }),
      ]);

      const spine = tracks[0]!.edges.find((d) => d.includes("V"))!;
      const [, from, to] = spine.match(/^M\d+ (\d+) V(\d+)$/)!;
      expect(Number(from)).toBe(CARD_H / 2);
      expect(Number(to)).toBe(CARD_H + ROW_GAP + CARD_H / 2);
    });
  });

  describe("state", () => {
    it("calls a quest ready when it has no predecessor", () => {
      const [track] = layout.build([quest(1)]);
      expect(track!.nodes[0]!.state).toBe("ready");
    });

    it("calls a quest ready once its predecessor is done", () => {
      const tracks = layout.build([
        quest(1, { status: "completed" }),
        quest(2, { dependsOn: 1 }),
      ]);
      expect(tracks[0]!.nodes[1]!.state).toBe("ready");
    });

    it("calls a quest waiting while its predecessor is open", () => {
      const tracks = layout.build([quest(1), quest(2, { dependsOn: 1 })]);
      expect(tracks[0]!.nodes[1]!.state).toBe("waiting");
    });

    it("reads lifecycle states straight off the quest", () => {
      const tracks = layout.build([
        quest(1, { status: "accepted" }),
        quest(2, { status: "completed" }),
        quest(3, { status: "shelved" }),
      ]);
      expect(tracks.map((t) => t.nodes[0]!.state)).toEqual([
        "running",
        "done",
        "shelved",
      ]);
    });

    it("never calls a quest ready when its blocker is outside the set", () => {
      // The epic's Flow tab sees only the epic's own quests, so a blocker
      // filed elsewhere is invisible. Ready would be a claim we cannot make.
      const tracks = layout.build([quest(2, { dependsOn: 99 })]);

      expect(tracks[0]!.nodes[0]!.state).toBe("waiting");
      expect(tracks[0]!.nodes[0]!.prevId).toBeUndefined();
    });
  });

  describe("links", () => {
    it("exposes the single predecessor and every dependent", () => {
      const tracks = layout.build([
        quest(1),
        quest(2, { dependsOn: 1 }),
        quest(3, { dependsOn: 1 }),
      ]);

      const [root, ...children] = tracks[0]!.nodes;
      expect(root!.prevId).toBeUndefined();
      expect(root!.nextIds).toEqual([2, 3]);
      expect(children.map((n) => n.prevId)).toEqual([1, 1]);
      expect(children.every((n) => n.nextIds.length === 0)).toBe(true);
    });
  });

  describe("bad data", () => {
    it("terminates on a dependsOn cycle instead of recursing forever", () => {
      // Not reachable through the API, but ON DELETE SET NULL and hand-edited
      // rows both exist; a render loop here would take the page down.
      const tracks = layout.build([
        quest(1, { dependsOn: 2 }),
        quest(2, { dependsOn: 1 }),
      ]);

      expect(tracks.flatMap((t) => t.nodes)).not.toHaveLength(0);
    });

    it("returns nothing for an empty set", () => {
      expect(layout.build([])).toEqual([]);
    });
  });
});
