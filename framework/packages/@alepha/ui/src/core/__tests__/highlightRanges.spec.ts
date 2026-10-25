import { describe, it } from "vitest";

import { highlightRanges } from "../highlightRanges.ts";

const marked = (text: string, query: string | undefined) =>
  highlightRanges(text, query).map(([start, end]) => text.slice(start, end));

describe("highlightRanges", () => {
  it("marks every occurrence, ignoring case", ({ expect }) => {
    expect(marked("Camille Martin", "ca")).toEqual(["Ca"]);
    // "Banana" holds two touching "an": one mark, not two side by side.
    expect(marked("Anna Banana", "an")).toEqual(["An", "anan"]);
    expect(marked("Anna Banana", "ba")).toEqual(["Ba"]);
  });

  it("marks each word of the query on its own", ({ expect }) => {
    expect(marked("Camille Martin", "martin cam")).toEqual(["Cam", "Martin"]);
  });

  it("merges overlapping and touching matches", ({ expect }) => {
    expect(highlightRanges("abcdef", "abc cde")).toEqual([[0, 5]]);
    expect(highlightRanges("abcdef", "abc def")).toEqual([[0, 6]]);
  });

  it("ignores diacritics on both sides", ({ expect }) => {
    expect(marked("Léa Robert", "lea")).toEqual(["Léa"]);
    expect(marked("Lea Robert", "léa")).toEqual(["Lea"]);
    // Decomposed text: the accent stays inside the mark.
    expect(marked("Léa", "le")).toEqual(["Lé"]);
  });

  it("treats the query as text, not a pattern", ({ expect }) => {
    expect(marked("a.b (c) *", ".b (c")).toEqual([".b", "(c"]);
    expect(marked("abc", ".")).toEqual([]);
  });

  it("marks nothing for an empty or missing query", ({ expect }) => {
    expect(highlightRanges("Camille", undefined)).toEqual([]);
    expect(highlightRanges("Camille", "   ")).toEqual([]);
    expect(highlightRanges("", "ca")).toEqual([]);
  });
});
