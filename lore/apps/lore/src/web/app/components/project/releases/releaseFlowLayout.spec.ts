import { describe, expect, it } from "vitest";

import type { ReleaseContentQuest } from "@/api/schemas/releaseContentQuestSchema.ts";

import { CARD_H, CARD_W } from "../quest/questline/questlineLayout.ts";
import type { ReleaseContentsEpic } from "./ReleaseContents.tsx";
import {
  CLUSTER_GAP_X,
  CLUSTER_GAP_Y,
  CLUSTER_HEADER,
  CLUSTER_PAD,
  ReleaseFlowLayout,
  TRACK_GAP,
} from "./releaseFlowLayout.ts";

const quest = (
  id: number,
  options: Partial<
    Pick<
      ReleaseContentQuest,
      "dependsOn" | "completedAt" | "acceptedAt" | "shelvedAt"
    >
  > = {},
): ReleaseContentQuest => ({
  id,
  shortId: id,
  title: `Quest ${id}`,
  area: "orm",
  priority: "medium",
  ...options,
});

const epic = (
  id: number,
  options: { dependsOn?: number; quests?: ReleaseContentQuest[] } = {},
): ReleaseContentsEpic => ({
  id,
  number: id,
  title: `Epic ${id}`,
  status: "planned",
  dependsOn: options.dependsOn,
  quests: options.quests ?? [],
});

const AT = "2026-09-04T00:00:00.000Z";

/**
 * An epic with no quests: a header over an empty body.
 */
const EMPTY_W = CARD_W + 2 * CLUSTER_PAD;
const EMPTY_H = CLUSTER_HEADER + 2 * CLUSTER_PAD;

describe("ReleaseFlowLayout", () => {
  const layout = new ReleaseFlowLayout();

  describe("clusters", () => {
    it("sizes a cluster from its questlines, header and padding included", () => {
      const map = layout.build({
        epics: [epic(1, { quests: [quest(1), quest(2)] })],
        looseQuests: [],
      });

      const [group] = map.epics;
      expect(group!.tracks).toHaveLength(2);
      expect(group!.width).toBe(CARD_W + 2 * CLUSTER_PAD);
      expect(group!.height).toBe(
        2 * CARD_H + TRACK_GAP + CLUSTER_HEADER + 2 * CLUSTER_PAD,
      );
    });

    it("gives an epic with no quests a box the width of one card", () => {
      const map = layout.build({ epics: [epic(1)], looseQuests: [] });

      expect(map.epics[0]!.width).toBe(EMPTY_W);
      expect(map.epics[0]!.height).toBe(EMPTY_H);
    });

    it("reads a quest's state off its timestamps, not off a metadata block", () => {
      const map = layout.build({
        epics: [
          epic(1, {
            quests: [
              quest(1, { completedAt: AT }),
              quest(2, { dependsOn: 1 }),
              quest(3, { acceptedAt: AT }),
              quest(4, { shelvedAt: AT }),
              quest(5, { dependsOn: 3 }),
            ],
          }),
        ],
        looseQuests: [],
      });

      const states = new Map(
        map.epics[0]!.tracks.flatMap((track) => track.nodes).map((node) => [
          node.quest.id,
          node.state,
        ]),
      );
      expect(states.get(1)).toBe("done");
      expect(states.get(2)).toBe("ready");
      expect(states.get(3)).toBe("running");
      expect(states.get(4)).toBe("shelved");
      expect(states.get(5)).toBe("waiting");
    });
  });

  describe("the epic forest", () => {
    it("places a dependent one column right of its predecessor, joined by one edge", () => {
      const map = layout.build({
        epics: [epic(1), epic(2, { dependsOn: 1 })],
        looseQuests: [],
      });

      const [a, b] = map.epics;
      expect(a!.depth).toBe(0);
      expect(b!.depth).toBe(1);
      expect(b!.x).toBe(a!.width + CLUSTER_GAP_X);
      // Same height, so the same row: the edge is a straight line.
      expect(b!.y).toBe(a!.y);
      expect(b!.prevId).toBe(1);
      expect(a!.nextIds).toEqual([2]);
      expect(map.edges).toHaveLength(1);
      expect(map.edges[0]).toMatch(/^M[\d.]+ [\d.]+ H[\d.]+$/);
    });

    it("walks a chain of three into three columns", () => {
      const map = layout.build({
        epics: [epic(1), epic(2, { dependsOn: 1 }), epic(3, { dependsOn: 2 })],
        looseQuests: [],
      });

      expect(map.epics.map((group) => group.depth)).toEqual([0, 1, 2]);
      expect(map.edges).toHaveLength(2);
      expect(map.width).toBe(3 * EMPTY_W + 2 * CLUSTER_GAP_X);
    });

    it("stacks a fork's dependents and centres the predecessor between them", () => {
      const map = layout.build({
        epics: [epic(1), epic(2, { dependsOn: 1 }), epic(3, { dependsOn: 1 })],
        looseQuests: [],
      });

      const [a, b, c] = map.epics;
      expect(c!.y).toBe(b!.y + b!.height + CLUSTER_GAP_Y);
      expect(a!.y + a!.height / 2).toBeCloseTo((b!.y + c!.y + c!.height) / 2);
      // A trunk, a spine, and one branch per dependent.
      expect(map.edges).toHaveLength(4);
    });

    it("lays an epic whose predecessor is outside the release out as a root", () => {
      const map = layout.build({
        epics: [epic(5, { dependsOn: 99 })],
        looseQuests: [],
      });

      expect(map.epics[0]!.depth).toBe(0);
      expect(map.epics[0]!.prevId).toBeUndefined();
      expect(map.edges).toEqual([]);
    });

    it("orders roots by epic number, top to bottom", () => {
      const map = layout.build({
        epics: [epic(3), epic(1), epic(2)],
        looseQuests: [],
      });

      expect(map.epics.map((group) => group.epic.number)).toEqual([1, 2, 3]);
      expect(map.epics.map((group) => group.y)).toEqual([
        0,
        EMPTY_H + CLUSTER_GAP_Y,
        2 * (EMPTY_H + CLUSTER_GAP_Y),
      ]);
    });

    it("makes a column as wide as its widest cluster", () => {
      const wide = epic(1, {
        quests: [
          quest(1),
          quest(2, { dependsOn: 1 }),
          quest(3, { dependsOn: 2 }),
        ],
      });
      const map = layout.build({
        epics: [wide, epic(2), epic(3, { dependsOn: 2 })],
        looseQuests: [],
      });

      const third = map.epics.find((group) => group.epic.id === 3)!;
      const first = map.epics.find((group) => group.epic.id === 1)!;
      expect(third.x).toBe(first.width + CLUSTER_GAP_X);
    });

    it("never lets a tall predecessor overlap the subtree beside it", () => {
      const map = layout.build({
        epics: [
          epic(1, { quests: [quest(1), quest(2), quest(3)] }),
          epic(2, { dependsOn: 1 }),
          epic(3),
        ],
        looseQuests: [],
      });

      const tall = map.epics.find((group) => group.epic.id === 1)!;
      const next = map.epics.find((group) => group.epic.id === 3)!;
      expect(tall.y).toBe(0);
      expect(next.y).toBeGreaterThanOrEqual(
        tall.y + tall.height + CLUSTER_GAP_Y,
      );
    });

    it("terminates on a dependsOn cycle and draws it as a chain", () => {
      const map = layout.build({
        epics: [epic(1, { dependsOn: 2 }), epic(2, { dependsOn: 1 })],
        looseQuests: [],
      });

      expect(map.epics.map((group) => [group.epic.id, group.depth])).toEqual([
        [1, 0],
        [2, 1],
      ]);
      expect(map.edges).toHaveLength(1);
    });
  });

  describe("the loose group", () => {
    it("sits below the forest, flush left, with no epic", () => {
      const map = layout.build({
        epics: [epic(1)],
        looseQuests: [quest(7)],
      });

      expect(map.loose?.epic).toBeUndefined();
      expect(map.loose?.x).toBe(0);
      expect(map.loose?.y).toBe(EMPTY_H + CLUSTER_GAP_Y);
      expect(map.height).toBe(map.loose!.y + map.loose!.height);
    });

    it("starts at the top when the release has no epic", () => {
      const map = layout.build({ epics: [], looseQuests: [quest(7)] });

      expect(map.loose?.y).toBe(0);
      expect(map.width).toBe(map.loose!.width);
    });

    it("is absent when every quest is under an epic", () => {
      const map = layout.build({
        epics: [epic(1, { quests: [quest(1)] })],
        looseQuests: [],
      });

      expect(map.loose).toBeNull();
    });
  });

  describe("empty", () => {
    it("returns nothing to draw for an empty release", () => {
      expect(layout.build({ epics: [], looseQuests: [] })).toEqual({
        epics: [],
        loose: null,
        edges: [],
        width: 0,
        height: 0,
      });
    });
  });
});
