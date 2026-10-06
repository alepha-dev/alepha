import { describe, expect, it } from "vitest";

import { KanbanColumnOrder } from "./kanbanColumnOrder.ts";

describe("KanbanColumnOrder", () => {
  const order = new KanbanColumnOrder();
  const columns = ["Todo", "Doing", "Review", "Done"];

  describe("move", () => {
    it("moves an item up, landing it before the target", () => {
      expect(order.move(columns, "Review", "Todo")).toEqual([
        "Review",
        "Todo",
        "Doing",
        "Done",
      ]);
    });

    it("moves an item down, landing it after the target", () => {
      expect(order.move(columns, "Todo", "Review")).toEqual([
        "Doing",
        "Review",
        "Todo",
        "Done",
      ]);
    });

    it("moves to the last position", () => {
      expect(order.move(columns, "Todo", "Done")).toEqual([
        "Doing",
        "Review",
        "Done",
        "Todo",
      ]);
    });

    it("moves to the first position", () => {
      expect(order.move(columns, "Done", "Todo")).toEqual([
        "Done",
        "Todo",
        "Doing",
        "Review",
      ]);
    });

    it("swaps two adjacent items in either direction", () => {
      expect(order.move(columns, "Doing", "Review")).toEqual([
        "Todo",
        "Review",
        "Doing",
        "Done",
      ]);
      expect(order.move(columns, "Review", "Doing")).toEqual([
        "Todo",
        "Review",
        "Doing",
        "Done",
      ]);
    });
  });

  /**
   * The server refuses anything that is not a permutation of the current
   * list, so these cases must not produce a request at all.
   */
  describe("no-ops", () => {
    it("returns the list unchanged when dropped on itself", () => {
      expect(order.move(columns, "Doing", "Doing")).toEqual(columns);
    });

    it("returns the list unchanged when a name is absent", () => {
      expect(order.move(columns, "Ghost", "Todo")).toEqual(columns);
      expect(order.move(columns, "Todo", "Ghost")).toEqual(columns);
    });

    it("handles a single-column list", () => {
      expect(order.move(["Todo"], "Todo", "Todo")).toEqual(["Todo"]);
    });
  });

  /**
   * Whatever the move, the result has to stay a permutation — that is the
   * exact predicate `reorderKanbanColumns` validates before it writes.
   */
  describe("permutation invariant", () => {
    it("preserves length and membership for every ordered pair", () => {
      for (const active of columns) {
        for (const over of columns) {
          const next = order.move(columns, active, over);
          expect(next).toHaveLength(columns.length);
          expect([...next].sort()).toEqual([...columns].sort());
          expect(new Set(next).size).toBe(next.length);
        }
      }
    });
  });
});
