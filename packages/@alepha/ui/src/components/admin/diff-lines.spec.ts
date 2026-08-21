import { describe, expect, it } from "vitest";

import { diffLines } from "./diff-lines.ts";

describe("diffLines", () => {
  it("marks every line as unchanged for identical input", () => {
    const text = "a\nb\nc";
    expect(diffLines(text, text)).toEqual([
      { type: "same", text: "a" },
      { type: "same", text: "b" },
      { type: "same", text: "c" },
    ]);
  });

  it("detects a changed line as a remove followed by an add", () => {
    const result = diffLines("a\nb\nc", "a\nB\nc");
    expect(result).toEqual([
      { type: "same", text: "a" },
      { type: "remove", text: "b" },
      { type: "add", text: "B" },
      { type: "same", text: "c" },
    ]);
  });

  it("detects pure additions", () => {
    const result = diffLines("a\nb", "a\nb\nc");
    expect(result).toEqual([
      { type: "same", text: "a" },
      { type: "same", text: "b" },
      { type: "add", text: "c" },
    ]);
  });

  it("detects pure removals", () => {
    const result = diffLines("a\nb\nc", "a\nc");
    expect(result).toEqual([
      { type: "same", text: "a" },
      { type: "remove", text: "b" },
      { type: "same", text: "c" },
    ]);
  });

  it("handles an empty before (all added)", () => {
    expect(diffLines("", "x")).toEqual([
      { type: "remove", text: "" },
      { type: "add", text: "x" },
    ]);
  });

  it("preserves the LCS so unchanged lines are not duplicated", () => {
    const before = JSON.stringify({ a: 1, b: 2 }, null, 2);
    const after = JSON.stringify({ a: 1, b: 3 }, null, 2);
    const result = diffLines(before, after);
    const added = result.filter((l) => l.type === "add");
    const removed = result.filter((l) => l.type === "remove");
    expect(added).toEqual([{ type: "add", text: '  "b": 3' }]);
    expect(removed).toEqual([{ type: "remove", text: '  "b": 2' }]);
  });
});
