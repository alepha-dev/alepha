import { describe, expect, it } from "vitest";
import { paginateLocal } from "../paginate-local.ts";

interface Row {
  id: number;
  title: string;
  area: string;
  tags: string[];
  score: number;
  createdAt: string;
}

const row = (over: Partial<Row> & { id: number }): Row => ({
  title: `row ${over.id}`,
  area: "core",
  tags: [],
  score: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => row({ id: i + 1 }));

describe("paginateLocal", () => {
  describe("paging", () => {
    it("returns the slice for the requested page", () => {
      const result = paginateLocal(rows(25), { page: 2, size: 10 });

      expect(result.content.map((r) => r.id)).toEqual([21, 22, 23, 24, 25]);
    });

    it("reports totals across the whole set, not the page", () => {
      const result = paginateLocal(rows(25), { page: 0, size: 10 });

      expect(result.page.totalElements).toBe(25);
      expect(result.page.totalPages).toBe(3);
      expect(result.page.numberOfElements).toBe(10);
      expect(result.page.offset).toBe(0);
    });

    it("flags the first and last page", () => {
      const first = paginateLocal(rows(25), { page: 0, size: 10 });
      const last = paginateLocal(rows(25), { page: 2, size: 10 });

      expect([first.page.isFirst, first.page.isLast]).toEqual([true, false]);
      expect([last.page.isFirst, last.page.isLast]).toEqual([false, true]);
    });

    it("returns an empty page rather than clamping past the end", () => {
      // The table's pager reads `page.number` back as its own position, so a
      // clamped number here would desynchronize the highlighted page button
      // from the `page` state the next/prev buttons increment.
      const result = paginateLocal(rows(5), { page: 9, size: 10 });

      expect(result.content).toEqual([]);
      expect(result.page.number).toBe(9);
      expect(result.page.isEmpty).toBe(true);
      expect(result.page.isLast).toBe(true);
    });

    it("reports an empty set as a single empty first page", () => {
      const result = paginateLocal([], { page: 0, size: 10 });

      expect(result.page.totalElements).toBe(0);
      expect(result.page.totalPages).toBe(0);
      expect(result.page.isFirst).toBe(true);
      expect(result.page.isLast).toBe(true);
    });
  });

  describe("sorting", () => {
    const unsorted = [
      row({ id: 1, title: "banana", score: 10 }),
      row({ id: 2, title: "Apple", score: 2 }),
      row({ id: 3, title: "cherry", score: 30 }),
    ];

    it("sorts ascending on a bare field name", () => {
      const result = paginateLocal(unsorted, {
        page: 0,
        size: 10,
        sort: "title",
      });

      expect(result.content.map((r) => r.title)).toEqual([
        "Apple",
        "banana",
        "cherry",
      ]);
    });

    it("sorts descending on a `-field` name", () => {
      const result = paginateLocal(unsorted, {
        page: 0,
        size: 10,
        sort: "-title",
      });

      expect(result.content.map((r) => r.title)).toEqual([
        "cherry",
        "banana",
        "Apple",
      ]);
    });

    it("compares numbers by value, not lexicographically", () => {
      // The whole point: a `String(a) < String(b)` comparator puts 10 before
      // 2, which reads as a sorted column that is quietly wrong.
      const result = paginateLocal(unsorted, {
        page: 0,
        size: 10,
        sort: "score",
      });

      expect(result.content.map((r) => r.score)).toEqual([2, 10, 30]);
    });

    it("puts nullish values last in both directions", () => {
      const withGaps = [
        row({ id: 1, area: "core" }),
        { ...row({ id: 2 }), area: undefined as unknown as string },
        row({ id: 3, area: "api" }),
      ];

      const asc = paginateLocal(withGaps, { page: 0, size: 10, sort: "area" });
      const desc = paginateLocal(withGaps, {
        page: 0,
        size: 10,
        sort: "-area",
      });

      expect(asc.content.map((r) => r.id)).toEqual([3, 1, 2]);
      // Still last, not first: an empty cell is missing data, and burying it
      // is right whichever way the reader pointed the arrow.
      expect(desc.content.map((r) => r.id)).toEqual([1, 3, 2]);
    });

    it("uses a sortValues accessor when the field is not a plain property", () => {
      const result = paginateLocal(unsorted, {
        page: 0,
        size: 10,
        sort: "titleLength",
        sortValues: { titleLength: (r) => r.title.length },
      });

      expect(result.content.map((r) => r.title)).toEqual([
        "Apple",
        "banana",
        "cherry",
      ]);
    });

    it("sorts the whole set before slicing", () => {
      const result = paginateLocal(rows(25), {
        page: 0,
        size: 3,
        sort: "-id",
      });

      expect(result.content.map((r) => r.id)).toEqual([25, 24, 23]);
    });
  });

  describe("filtering", () => {
    const mixed = [
      row({ id: 1, title: "Ship the parser", area: "core", tags: ["perf"] }),
      row({
        id: 2,
        title: "Parse the ship",
        area: "api",
        tags: ["dx", "perf"],
      }),
      row({ id: 3, title: "Unrelated", area: "core", tags: [] }),
    ];

    it("narrows the set with the caller predicate", () => {
      const result = paginateLocal(mixed, {
        page: 0,
        size: 10,
        filters: { search: "ship" },
        filter: (r, f) =>
          r.title.toLowerCase().includes(String(f.search).toLowerCase()),
      });

      expect(result.content.map((r) => r.id)).toEqual([1, 2]);
    });

    it("counts the filtered set, not the original", () => {
      // The pager is drawn from `totalElements`. Counting the unfiltered
      // array would offer pages that render empty.
      const result = paginateLocal(mixed, {
        page: 0,
        size: 10,
        filters: { area: "core" },
      });

      expect(result.page.totalElements).toBe(2);
      expect(result.page.totalPages).toBe(1);
    });

    it("filters before sorting and slicing", () => {
      // `area: "api"` rather than `"core"`: the unfiltered set sorted by
      // `-id` also starts with a core row, so a core filter here would pass
      // whether or not filtering runs at all.
      const result = paginateLocal(mixed, {
        page: 0,
        size: 1,
        sort: "-id",
        filters: { area: "api" },
      });

      expect(result.content.map((r) => r.id)).toEqual([2]);
    });

    it("matches a string filter as a case-insensitive substring by default", () => {
      // "THE SHIP" and not "PARSE": row 1's "parser" contains "parse", so
      // that fixture would match both rows and prove only the substring
      // half of the claim.
      const result = paginateLocal(mixed, {
        page: 0,
        size: 10,
        filters: { title: "THE SHIP" },
      });

      expect(result.content.map((r) => r.id)).toEqual([2]);
    });

    it("matches an array-valued property when the filter value is a member", () => {
      const result = paginateLocal(mixed, {
        page: 0,
        size: 10,
        filters: { tags: "dx" },
      });

      expect(result.content.map((r) => r.id)).toEqual([2]);
    });

    it("compares non-string filter values strictly", () => {
      const result = paginateLocal(mixed, {
        page: 0,
        size: 10,
        filters: { id: 2 },
      });

      expect(result.content.map((r) => r.id)).toEqual([2]);
    });

    it("ignores empty filter values", () => {
      // A cleared Control sets `undefined`; an emptied text input sets "".
      // Either one treated as a real value empties the table for no reason
      // the reader can see.
      const result = paginateLocal(mixed, {
        page: 0,
        size: 10,
        filters: { area: undefined, title: "", tags: null },
      });

      expect(result.content.map((r) => r.id)).toEqual([1, 2, 3]);
    });

    it("requires every active filter to match", () => {
      const result = paginateLocal(mixed, {
        page: 0,
        size: 10,
        filters: { area: "core", title: "ship" },
      });

      expect(result.content.map((r) => r.id)).toEqual([1]);
    });

    it("keeps rows whose filter key is not a property of the row", () => {
      // The default is sugar for the common case, not a validator. A filter
      // field the rows do not carry belongs to a `filter` the caller owns,
      // and silently emptying the table is the worst way to say so.
      const result = paginateLocal(mixed, {
        page: 0,
        size: 10,
        filters: { assignee: "someone" },
      });

      expect(result.content.map((r) => r.id)).toEqual([1, 2, 3]);
    });
  });
});
