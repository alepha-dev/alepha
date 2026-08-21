import { describe, expect, it } from "vitest";

import {
  DIAGRAM_FONT_SIZE,
  MAX_LABEL_LINES,
  MAX_LABEL_WIDTH,
  measureLabel,
  measureLine,
  measureNode,
} from "./textMetrics.ts";

describe("measureLine", () => {
  it("measures nothing as zero", () => {
    expect(measureLine("", DIAGRAM_FONT_SIZE)).toBe(0);
  });

  it("scales linearly with the font size", () => {
    const single = measureLine("Hello world", DIAGRAM_FONT_SIZE);
    const double = measureLine("Hello world", DIAGRAM_FONT_SIZE * 2);
    expect(double).toBeCloseTo(single * 2, 5);
  });

  it("measures a wide run wider than a narrow one of the same length", () => {
    expect(measureLine("mmmm", DIAGRAM_FONT_SIZE)).toBeGreaterThan(
      measureLine("iiii", DIAGRAM_FONT_SIZE) * 2,
    );
  });

  it("grows with length", () => {
    expect(measureLine("aaaa", DIAGRAM_FONT_SIZE)).toBeGreaterThan(
      measureLine("aa", DIAGRAM_FONT_SIZE),
    );
  });

  it("gives an unlisted character a bounded fallback width", () => {
    const cjk = measureLine("漢字漢字", DIAGRAM_FONT_SIZE);
    expect(cjk).toBeGreaterThan(0);
    expect(cjk).toBeLessThan(DIAGRAM_FONT_SIZE * 4 * 2);
  });

  it.each([
    ["MarkdownView", 94.263],
    ["Start", 29.307],
    ["the quick brown fox", 121.393],
  ])("is within 5%% of Chromium's own measurement of %s", (text, browser) => {
    // Measured in Chromium against the real Inter woff2 by
    // scripts/measure-font.mjs, in the same run that generated the table.
    // The gap is rounding the ratios to three decimals, and 5% off on a box
    // width is invisible in a boxes-and-arrows diagram.
    const error = Math.abs(measureLine(text, 13) - browser) / browser;
    expect(error).toBeLessThan(0.05);
  });
});

describe("measureLabel", () => {
  it("takes the width of the widest line", () => {
    const metrics = measureLabel(["a", "wider line here"]);
    expect(metrics.width).toBeCloseTo(
      measureLine("wider line here", DIAGRAM_FONT_SIZE),
      5,
    );
  });

  it("grows the height per line", () => {
    const one = measureLabel(["a"]);
    const two = measureLabel(["a", "b"]);
    const three = measureLabel(["a", "b", "c"]);
    expect(two.height - one.height).toBeCloseTo(three.height - two.height, 5);
    expect(two.height).toBeGreaterThan(one.height);
  });

  it("returns the lines it actually measured", () => {
    expect(measureLabel(["one", "two"]).lines).toEqual(["one", "two"]);
  });

  it("wraps a long line at word boundaries instead of widening", () => {
    const long =
      "the quick brown fox jumps over the lazy dog and keeps going for a while";
    const metrics = measureLabel([long]);
    expect(metrics.lines.length).toBeGreaterThan(1);
    expect(metrics.width).toBeLessThanOrEqual(MAX_LABEL_WIDTH);
    expect(metrics.lines.join(" ")).toBe(long);
  });

  it("truncates a single unbreakable token rather than widening the box", () => {
    const metrics = measureLabel(["x".repeat(400)]);
    expect(metrics.width).toBeLessThanOrEqual(MAX_LABEL_WIDTH);
    expect(metrics.lines).toHaveLength(1);
    expect(metrics.lines[0].endsWith("…")).toBe(true);
  });

  it("caps the number of lines and marks the cut", () => {
    const metrics = measureLabel(
      Array.from({ length: 40 }, (_, i) => `line ${i}`),
    );
    expect(metrics.lines).toHaveLength(MAX_LABEL_LINES);
    expect(metrics.lines[MAX_LABEL_LINES - 1].endsWith("…")).toBe(true);
  });

  it("gives an empty label a non-zero box", () => {
    const metrics = measureLabel([""]);
    expect(metrics.width).toBeGreaterThan(0);
    expect(metrics.height).toBeGreaterThan(0);
  });
});

describe("measureNode - a circle has to contain its text", () => {
  it("fits the label box inside the ellipse", () => {
    const lines = ["themed SVG"];
    const label = measureLabel(lines);
    const box = measureNode({ lines, shape: "circle" });
    // An axis-aligned w x h box fits an ellipse when
    // (w/2 / rx)^2 + (h/2 / ry)^2 <= 1.
    const rx = box.width / 2;
    const ry = box.height / 2;
    const fit = (label.width / 2 / rx) ** 2 + (label.height / 2 / ry) ** 2;
    expect(fit).toBeLessThanOrEqual(1);
  });

  it("does not force a square on a wide label", () => {
    const box = measureNode({
      lines: ["a fairly wide label"],
      shape: "circle",
    });
    expect(box.width).toBeGreaterThan(box.height);
    expect(box.width / box.height).toBeLessThan(4);
  });
});
