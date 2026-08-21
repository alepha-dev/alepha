import { describe, expect, it } from "vitest";

import {
  folioFindMatches,
  stepFolioMatch,
} from "@/web/app/components/folios/editor/document/folioFindMatches.ts";

describe("folioFindMatches", () => {
  it("returns nothing for an empty needle", () => {
    expect(folioFindMatches("hello world", "")).toEqual([]);
  });

  it("returns nothing for an empty haystack", () => {
    expect(folioFindMatches("", "hello")).toEqual([]);
  });

  it("finds every occurrence with its offsets", () => {
    expect(folioFindMatches("folio folio", "folio")).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 11 },
    ]);
  });

  it("is case-insensitive", () => {
    expect(folioFindMatches("Folio FOLIO folio", "folio")).toHaveLength(3);
  });

  it("finds overlapping-adjacent occurrences without skipping", () => {
    expect(folioFindMatches("aaaa", "aa")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("treats the needle as literal text, not a regex", () => {
    expect(folioFindMatches("a.c abc", "a.c")).toEqual([{ start: 0, end: 3 }]);
  });

  it("matches across what were separate text nodes", () => {
    expect(folioFindMatches("directory tree", "ory tr")).toEqual([
      { start: 6, end: 12 },
    ]);
  });

  it("returns nothing when needle is longer than haystack", () => {
    expect(folioFindMatches("hi", "hello")).toEqual([]);
  });

  it("finds a single match when needle equals haystack", () => {
    expect(folioFindMatches("hello", "hello")).toEqual([{ start: 0, end: 5 }]);
  });

  it("finds matches in a haystack of repeated characters", () => {
    expect(folioFindMatches("aaaaaaa", "a")).toHaveLength(7);
  });

  it("finds multiple adjacent non-overlapping matches", () => {
    const result = folioFindMatches("aaaa", "aa");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ start: 0, end: 2 });
    expect(result[1]).toEqual({ start: 2, end: 4 });
  });

  it("finds a match at the start and at the end", () => {
    expect(folioFindMatches("hello hello", "hello")).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 11 },
    ]);
  });

  it("handles single character matches", () => {
    expect(folioFindMatches("abc", "a")).toEqual([{ start: 0, end: 1 }]);
  });

  it("finds no matches for a needle that is not in the haystack", () => {
    expect(folioFindMatches("hello world", "xyz")).toEqual([]);
  });

  it("is case-insensitive for single character searches", () => {
    expect(folioFindMatches("AaBbCc", "a")).toHaveLength(2);
  });

  it("returns offsets that index the original haystack", () => {
    /**
     * This is the critical round-trip test: haystack.slice(start, end) must
     * equal the text that matched. This ensures offsets work correctly even
     * for characters that change length when lowercased (like İ/U+0130).
     */
    const cases: [string, string][] = [
      ["folio folio", "folio"],
      ["Folio FOLIO folio", "folio"],
      ["aİb dot", "dot"], // İ lowercases to two code units; without this fix, offsets after it shift by 1
      ["İİİ needle here", "needle"],
      ["a.c abc", "a.c"],
      ["straße test", "test"], // ß: another length-changing character
      ["aaaa", "aa"],
    ];
    for (const [haystack, needle] of cases) {
      for (const m of folioFindMatches(haystack, needle)) {
        expect(
          haystack.slice(m.start, m.end).toLowerCase(),
          `${JSON.stringify(haystack)} / ${JSON.stringify(needle)}`,
        ).toBe(needle.toLowerCase());
      }
    }
  });
});

describe("stepFolioMatch", () => {
  it("advances forward", () => {
    expect(stepFolioMatch(3, 0, 1)).toBe(1);
  });

  it("wraps past the end", () => {
    expect(stepFolioMatch(3, 2, 1)).toBe(0);
  });

  it("wraps before the start", () => {
    expect(stepFolioMatch(3, 0, -1)).toBe(2);
  });

  it("stays at 0 when there are no matches", () => {
    expect(stepFolioMatch(0, 0, 1)).toBe(0);
    expect(stepFolioMatch(0, 0, -1)).toBe(0);
  });

  it("advances multiple steps forward in sequence", () => {
    expect(stepFolioMatch(3, 0, 1)).toBe(1);
    expect(stepFolioMatch(3, 1, 1)).toBe(2);
    expect(stepFolioMatch(3, 2, 1)).toBe(0);
  });

  it("steps backward through matches", () => {
    expect(stepFolioMatch(3, 2, -1)).toBe(1);
    expect(stepFolioMatch(3, 1, -1)).toBe(0);
    expect(stepFolioMatch(3, 0, -1)).toBe(2);
  });

  it("returns 0 when count is negative", () => {
    expect(stepFolioMatch(-1, 0, 1)).toBe(0);
  });

  it("handles single match correctly", () => {
    expect(stepFolioMatch(1, 0, 1)).toBe(0);
    expect(stepFolioMatch(1, 0, -1)).toBe(0);
  });
});
