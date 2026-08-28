import { describe, expect, it } from "vitest";

import { BoardRank } from "../src/api/services/BoardRank.ts";

/**
 * The whole contract is one invariant — `a < between(a, b) < b` — so most
 * of this file asserts that under conditions a float index would fail:
 * repeated insertion into the same gap, and long runs.
 */
describe("BoardRank", () => {
  const rank = new BoardRank();

  describe("between", () => {
    it("ranks an empty column", () => {
      const only = rank.between();
      expect(only.length).toBeGreaterThan(0);
    });

    it("ranks before an existing card", () => {
      const first = rank.between();
      const before = rank.between(undefined, first);
      expect(before < first).toBe(true);
    });

    it("ranks after an existing card", () => {
      const first = rank.between();
      const after = rank.between(first, undefined);
      expect(after > first).toBe(true);
    });

    it("ranks between two cards", () => {
      const a = rank.between();
      const c = rank.between(a, undefined);
      const b = rank.between(a, c);
      expect(a < b).toBe(true);
      expect(b < c).toBe(true);
    });

    it("refuses bounds that are out of order", () => {
      expect(() => rank.between("n", "b")).toThrow();
      expect(() => rank.between("n", "n")).toThrow();
    });
  });

  /**
   * The reason this is a string and not a float. A float halves the gap
   * every time and runs out of mantissa after ~50 insertions, at which
   * point two cards compare equal and the column silently reorders.
   */
  describe("repeated insertion into the same gap", () => {
    it("survives 500 insertions between the same two neighbours", () => {
      const low = rank.between();
      const high = rank.between(low, undefined);

      let previous = high;
      const inserted: string[] = [];
      for (let i = 0; i < 500; i++) {
        const next = rank.between(low, previous);
        expect(next > low).toBe(true);
        expect(next < previous).toBe(true);
        inserted.push(next);
        previous = next;
      }

      // Every rank distinct, and every one still inside the original gap.
      expect(new Set(inserted).size).toBe(inserted.length);
      expect(inserted.every((r) => r > low && r < high)).toBe(true);
    });

    it("keeps a whole column ordered through random insertions", () => {
      // Deterministic pseudo-random: a seeded walk, so a failure is
      // reproducible rather than a once-a-month CI mystery.
      let seed = 12345;
      const nextIndex = (max: number) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % max;
      };

      const column: string[] = [rank.between()];
      for (let i = 0; i < 300; i++) {
        const at = nextIndex(column.length + 1);
        const before = at > 0 ? column[at - 1] : undefined;
        const after = at < column.length ? column[at] : undefined;
        column.splice(at, 0, rank.between(before, after));
      }

      const sorted = [...column].sort();
      expect(column).toEqual(sorted);
      expect(new Set(column).size).toBe(column.length);
    });
  });

  describe("sequence", () => {
    it("returns nothing for an empty list", () => {
      expect(rank.sequence(0)).toEqual([]);
    });

    it("returns strictly increasing ranks", () => {
      const ranks = rank.sequence(50);
      expect(ranks).toHaveLength(50);
      expect([...ranks].sort()).toEqual(ranks);
      expect(new Set(ranks).size).toBe(50);
    });

    it("leaves room to insert before the first one", () => {
      const ranks = rank.sequence(10);
      const head = rank.between(undefined, ranks[0]);
      expect(head < ranks[0]).toBe(true);
    });
  });

  /**
   * `"a"` is the one rank that must never be produced: nothing sorts before
   * it, since `"a" + anything` is greater than `"a"` itself, so a card
   * holding it could never be given a neighbour above it.
   */
  describe("the reserved lowest digit", () => {
    it("never produces a bare 'a'", () => {
      const produced = new Set(rank.sequence(200));
      let cursor: string | undefined;
      for (let i = 0; i < 200; i++) {
        cursor = rank.between(undefined, cursor);
        produced.add(cursor);
      }
      expect(produced.has("a")).toBe(false);
    });

    it("can always rank above whatever is currently first", () => {
      let first = rank.between();
      for (let i = 0; i < 200; i++) {
        const above = rank.between(undefined, first);
        expect(above < first).toBe(true);
        first = above;
      }
    });
  });
});
