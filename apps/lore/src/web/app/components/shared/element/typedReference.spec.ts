import { describe, expect, it } from "vitest";

import {
  formatReference,
  isReferenceKind,
  parseTypedReference,
  REFERENCE_LETTERS,
} from "./typedReference.ts";

/**
 * The grammar both parsers and every screen read through (epic #32). What
 * `formatReference` writes, `parseTypedReference` has to read back, for
 * every kind, or a label somewhere is not a reference anyone can type.
 */
describe("typedReference", () => {
  it("formats every kind as #<LETTER><n>", () => {
    expect(formatReference("quest", 12)).toBe("#Q12");
    expect(formatReference("epic", 3)).toBe("#E3");
    expect(formatReference("folio", 42)).toBe("#F42");
    expect(formatReference("feedback", 120)).toBe("#P120");
    expect(formatReference("release", 7)).toBe("#R7");
  });

  it("reads back what it wrote, for every letter", () => {
    for (const kind of Object.keys(REFERENCE_LETTERS)) {
      if (!isReferenceKind(kind)) throw new Error(kind);
      expect(parseTypedReference(formatReference(kind, 99))).toEqual({
        kind,
        id: 99,
      });
    }
  });

  it("is case-insensitive on the way in", () => {
    expect(parseTypedReference("#q12")).toEqual({ kind: "quest", id: 12 });
    expect(parseTypedReference("#p120")).toEqual({ kind: "feedback", id: 120 });
  });

  it("refuses what is not the grammar", () => {
    expect(parseTypedReference("#12")).toBeUndefined();
    expect(parseTypedReference("#X12")).toBeUndefined();
    expect(parseTypedReference("#Q12#section")).toBeUndefined();
    expect(parseTypedReference("quest:#12")).toBeUndefined();
    expect(parseTypedReference("Some Title")).toBeUndefined();
    expect(parseTypedReference("#Q")).toBeUndefined();
  });

  it("knows which link kinds have a letter", () => {
    expect(isReferenceKind("quest")).toBe(true);
    expect(isReferenceKind("release")).toBe(true);
    expect(isReferenceKind("blob")).toBe(false);
    expect(isReferenceKind("comment")).toBe(false);
    expect(isReferenceKind("toString")).toBe(false);
  });
});
