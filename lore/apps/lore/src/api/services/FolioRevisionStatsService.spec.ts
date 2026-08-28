import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { FolioRevisionStatsService } from "./FolioRevisionStatsService.ts";

const service = () => Alepha.create().inject(FolioRevisionStatsService);

describe("FolioRevisionStatsService.lineDiff", () => {
  it("reports nothing for identical text", () => {
    expect(service().lineDiff("a\nb", "a\nb")).toEqual({
      added: 0,
      removed: 0,
    });
  });

  it("counts an appended line", () => {
    expect(service().lineDiff("a\nb", "a\nb\nc")).toEqual({
      added: 1,
      removed: 0,
    });
  });

  it("counts a removed line", () => {
    expect(service().lineDiff("a\nb\nc", "a\nc")).toEqual({
      added: 0,
      removed: 1,
    });
  });

  it("counts a changed line as one out, one in", () => {
    expect(service().lineDiff("a\nb\nc", "a\nB\nc")).toEqual({
      added: 1,
      removed: 1,
    });
  });

  it("treats a MOVED block as unchanged", () => {
    // The whole reason this is an LCS and not a set difference. A set
    // difference reports 0/0 here too, but only by accident - it also
    // reports 0/0 for a genuine rewrite that happens to reuse the same
    // lines. The case below separates them.
    const before = "one\ntwo\nthree\nfour";
    const after = "three\nfour\none\ntwo";
    const { added, removed } = service().lineDiff(before, after);
    expect(added).toBe(removed);
    expect(added).toBeLessThanOrEqual(2);
  });

  it("ignores a trailing newline", () => {
    // Editors add and drop these silently; surfacing them as ±1 would make
    // every save look like an edit.
    expect(service().lineDiff("a\nb", "a\nb\n")).toEqual({
      added: 0,
      removed: 0,
    });
  });

  it("counts every line when starting from empty", () => {
    expect(service().lineDiff("", "a\nb\nc")).toEqual({
      added: 3,
      removed: 0,
    });
  });

  it("counts every line when emptied", () => {
    expect(service().lineDiff("a\nb", "")).toEqual({ added: 0, removed: 2 });
  });

  it("is symmetric under argument order", () => {
    const s = service();
    const forward = s.lineDiff("a\nb\nc", "a\nx\ny\nc");
    const back = s.lineDiff("a\nx\ny\nc", "a\nb\nc");
    expect(forward).toEqual({ added: back.removed, removed: back.added });
  });
});

describe("FolioRevisionStatsService.wordCount", () => {
  it("counts runs of non-whitespace", () => {
    expect(service().wordCount("one two  three")).toBe(3);
  });

  it("counts across newlines", () => {
    expect(service().wordCount("one\ntwo\n\nthree")).toBe(3);
  });

  it("is zero for empty and for whitespace", () => {
    expect(service().wordCount("")).toBe(0);
    expect(service().wordCount("  \n\t ")).toBe(0);
  });
});
