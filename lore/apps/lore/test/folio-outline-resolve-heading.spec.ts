import { describe, expect, it } from "vitest";

import type { FolioOutlineHeading } from "@/web/app/components/folios/editor/inspector/markdownOutline.ts";
import {
  type FolioOutlineDomHeading,
  resolveHeadingIndex,
} from "@/web/app/components/folios/editor/inspector/resolveHeadingIndex.ts";

/**
 * Regression coverage for the matching rules `FolioOutlineTab` relies on
 * to navigate a click to the right heading — pure and DOM-free, so it
 * runs as a plain node spec under the root `yarn test` command instead of
 * needing jsdom. The one branch that actually matters (parser
 * disagreement, `matches.length === 0`) has no browser-driven coverage
 * anywhere else in this task, which is exactly the gap this file closes.
 */

const heading = (
  level: number,
  text: string,
  index: number,
): FolioOutlineHeading => ({ level, text, index });

const dom = (level: number, text: string): FolioOutlineDomHeading => ({
  level,
  text,
});

describe("resolveHeadingIndex", () => {
  it("resolves an exact single text+level match", () => {
    const outline = [heading(1, "Getting Started", 0)];
    const domHeadings = [dom(1, "Getting Started")];
    expect(resolveHeadingIndex(outline, outline[0], domHeadings)).toBe(0);
  });

  it("picks the DOM occurrence whose rank matches the outline entry's rank, for duplicate text at the same level", () => {
    const outline = [
      heading(2, "Installation", 0),
      heading(2, "Configuration", 1),
      heading(2, "Installation", 2),
    ];
    const domHeadings = [
      dom(2, "Installation"),
      dom(2, "Configuration"),
      dom(2, "Installation"),
    ];
    // The FIRST "Installation" outline entry (rank 0 among duplicates)
    // must resolve to the FIRST matching DOM heading (index 0), not the
    // second (index 2).
    expect(resolveHeadingIndex(outline, outline[0], domHeadings)).toBe(0);
    // The SECOND "Installation" outline entry (rank 1 among duplicates)
    // must resolve to the SECOND matching DOM heading (index 2).
    expect(resolveHeadingIndex(outline, outline[2], domHeadings)).toBe(2);
  });

  it("does not collide identical text at different levels", () => {
    const outline = [heading(1, "Setup", 0), heading(2, "Setup", 1)];
    const domHeadings = [dom(1, "Setup"), dom(2, "Setup")];
    // Each entry must resolve to the DOM heading at its OWN level, even
    // though the text alone would match both.
    expect(resolveHeadingIndex(outline, outline[0], domHeadings)).toBe(0);
    expect(resolveHeadingIndex(outline, outline[1], domHeadings)).toBe(1);
  });

  it("falls back to the raw index when there is no text match at all (genuine parser disagreement)", () => {
    // The outline (our regex parser) found a heading whose rendered text
    // in the DOM (MDXEditor's CommonMark parser) doesn't match anything
    // — e.g. inline markdown resolved differently by the two parsers.
    // With no text match, the only signal left is position.
    const outline = [
      heading(1, "First", 0),
      heading(2, "Second (unmatched)", 1),
    ];
    const domHeadings = [dom(1, "First"), dom(2, "Something else entirely")];
    expect(resolveHeadingIndex(outline, outline[1], domHeadings)).toBe(1);
  });

  it("resolves to undefined, not a wrong index, when the fallback index is out of range (outline longer than the DOM list)", () => {
    const outline = [
      heading(1, "First", 0),
      heading(2, "Second (unmatched)", 1),
      heading(2, "Third (unmatched, out of range)", 2),
    ];
    // Only ONE DOM heading exists — indexes 1 and 2 are both out of
    // range. A stale/blind `elements[heading.index]` would silently
    // return `undefined` from an out-of-bounds array read; this asserts
    // that behavior explicitly rather than relying on it as luck.
    const domHeadings = [dom(1, "First")];
    expect(
      resolveHeadingIndex(outline, outline[2], domHeadings),
    ).toBeUndefined();
  });

  it("resolves to undefined for an empty DOM list (source mode, or before the editor mounts)", () => {
    const outline = [heading(1, "Getting Started", 0)];
    expect(resolveHeadingIndex(outline, outline[0], [])).toBeUndefined();
  });
});
