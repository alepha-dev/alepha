import { describe, expect, it } from "vitest";

import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

import type { ColumnDescriptor } from "./KanbanColumn.tsx";
import { KanbanGrouping } from "./kanbanGrouping.ts";

type Status = QuestResource["metadata"]["status"];

/**
 * Only the columns the grouping actually reads. The cast keeps the fixtures
 * to four fields instead of forcing every spec to spell out a whole quest.
 */
const quest = (
  id: number,
  options: {
    status?: Status;
    kanbanColumn?: string;
    updatedAt?: string;
  } = {},
): QuestResource =>
  ({
    id,
    shortId: id,
    title: `Quest ${id}`,
    kanbanColumn: options.kanbanColumn,
    updatedAt: options.updatedAt ?? "2026-08-01T00:00:00.000Z",
    metadata: { status: options.status ?? "new" },
  }) as unknown as QuestResource;

const column = (
  name: string,
  kind: ColumnDescriptor["kind"],
): ColumnDescriptor => ({
  key: `column:${name}`,
  kind,
  subColumn: name,
  label: name,
  dotClass: "",
});

/**
 * The frame a project with no column config resolves to.
 */
const defaultFrame = (...accepted: string[]): ColumnDescriptor[] => [
  column("New", "new"),
  ...accepted.map((name) => column(name, "accepted")),
  column("Completed", "completed"),
];

describe("KanbanGrouping", () => {
  const grouping = new KanbanGrouping();

  describe("placement", () => {
    it("gives every column a bucket, including the empty ones", () => {
      const byKey = grouping.group([], defaultFrame("In progress", "Review"));

      expect(Object.keys(byKey)).toEqual([
        "column:New",
        "column:In progress",
        "column:Review",
        "column:Completed",
      ]);
      expect(Object.values(byKey).every((b) => b.length === 0)).toBe(true);
    });

    it("puts a new quest in New and a completed one in Completed", () => {
      const byKey = grouping.group(
        [quest(1), quest(2, { status: "completed" })],
        defaultFrame("In progress"),
      );

      expect(byKey["column:New"].map((q) => q.id)).toEqual([1]);
      expect(byKey["column:Completed"].map((q) => q.id)).toEqual([2]);
    });

    it("puts an accepted quest in the column it names", () => {
      const byKey = grouping.group(
        [quest(1, { status: "accepted", kanbanColumn: "Review" })],
        defaultFrame("In progress", "Review"),
      );

      expect(byKey["column:Review"].map((q) => q.id)).toEqual([1]);
      expect(byKey["column:In progress"]).toEqual([]);
    });

    it("falls back to the first lane of its status when the column is gone", () => {
      const byKey = grouping.group(
        [quest(1, { status: "accepted", kanbanColumn: "Deleted lane" })],
        defaultFrame("In progress", "Review"),
      );

      expect(byKey["column:In progress"].map((q) => q.id)).toEqual([1]);
    });

    it("sorts a done column most-recently-updated first", () => {
      const byKey = grouping.group(
        [
          quest(1, { status: "completed", updatedAt: "2026-08-01T00:00:00Z" }),
          quest(2, { status: "completed", updatedAt: "2026-08-03T00:00:00Z" }),
          quest(3, { status: "completed", updatedAt: "2026-08-02T00:00:00Z" }),
        ],
        defaultFrame("In progress"),
      );

      expect(byKey["column:Completed"].map((q) => q.id)).toEqual([2, 3, 1]);
    });
  });

  /**
   * Quest #1227: the frame is configurable, and the lifecycle triple is
   * still the truth underneath. A column declares which state it collapses
   * to, so a project can have two done-ish lanes.
   */
  describe("a configurable frame", () => {
    const twoDone: ColumnDescriptor[] = [
      column("Backlog", "new"),
      column("Doing", "accepted"),
      column("Shipped", "completed"),
      column("Archived", "completed"),
    ];

    it("routes a completed quest to the done column it names", () => {
      const byKey = grouping.group(
        [quest(1, { status: "completed", kanbanColumn: "Archived" })],
        twoDone,
      );

      expect(byKey["column:Archived"].map((q) => q.id)).toEqual([1]);
      expect(byKey["column:Shipped"]).toEqual([]);
    });

    it("sends a completed quest naming no column to the first done lane", () => {
      const byKey = grouping.group(
        [quest(1, { status: "completed" })],
        twoDone,
      );

      expect(byKey["column:Shipped"].map((q) => q.id)).toEqual([1]);
    });

    it("uses a project's own not-started lane instead of a synthesized one", () => {
      const byKey = grouping.group([quest(1, { status: "new" })], twoDone);
      expect(byKey["column:Backlog"].map((q) => q.id)).toEqual([1]);
    });

    it("sorts every done column, not just one", () => {
      const byKey = grouping.group(
        [
          quest(1, {
            status: "completed",
            kanbanColumn: "Archived",
            updatedAt: "2026-08-01T00:00:00Z",
          }),
          quest(2, {
            status: "completed",
            kanbanColumn: "Archived",
            updatedAt: "2026-08-05T00:00:00Z",
          }),
        ],
        twoDone,
      );

      expect(byKey["column:Archived"].map((q) => q.id)).toEqual([2, 1]);
    });

    it("drops a quest whose status no column carries, rather than misfiling it", () => {
      // A frame with no done lane at all is legal: some boards never keep
      // finished work on screen. A completed quest must then be absent,
      // not silently parked in an in-progress column.
      const noDone = [column("Backlog", "new"), column("Doing", "accepted")];
      const byKey = grouping.group([quest(1, { status: "completed" })], noDone);

      expect(Object.values(byKey).flat()).toEqual([]);
    });
  });

  /**
   * The bug this class was extracted for. Shelving is the gesture that means
   * "I am not doing this"; before the guard, a shelved quest missed both the
   * `new` and `completed` branches and landed in the accepted fallback, so
   * the card visibly moved FORWARD into In progress.
   */
  describe("shelved quests", () => {
    it("drops a shelved quest from every column", () => {
      const byKey = grouping.group(
        [quest(1, { status: "shelved" })],
        defaultFrame("In progress", "Review"),
      );

      expect(Object.values(byKey).flat()).toEqual([]);
    });

    it("does not move a shelved quest into the first accepted lane", () => {
      const byKey = grouping.group(
        [quest(1, { status: "shelved" }), quest(2, { status: "accepted" })],
        defaultFrame("In progress"),
      );

      expect(byKey["column:In progress"].map((q) => q.id)).toEqual([2]);
    });

    it("keeps a shelved quest out even when it still names a column", () => {
      const byKey = grouping.group(
        [quest(1, { status: "shelved", kanbanColumn: "Review" })],
        defaultFrame("In progress", "Review"),
      );

      expect(byKey["column:Review"]).toEqual([]);
    });
  });
});
