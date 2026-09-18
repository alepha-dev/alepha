import { describe, it } from "vitest";

import {
  momentumDelta,
  momentumGeometry,
  monotonePath,
} from "./homeMomentumPath.ts";

/**
 * The control points of every cubic segment in a path, with its two ends.
 */
const segments = (d: string) => {
  const numbers = d.match(/-?\d+(\.\d+)?(e-?\d+)?/g)!.map(Number);
  const [x, y, ...rest] = numbers;
  const out: Array<{ from: number; c1: number; c2: number; to: number }> = [];
  let previous = y!;
  for (let i = 0; i < rest.length; i += 6) {
    out.push({
      from: previous,
      c1: rest[i + 1]!,
      c2: rest[i + 3]!,
      to: rest[i + 5]!,
    });
    previous = rest[i + 5]!;
  }
  return { start: [x, y], segments: out };
};

describe("momentum sparkline geometry", () => {
  it("never overshoots its points, so it never dips below the baseline", ({
    expect,
  }) => {
    // A busy day between empty ones: a plain spline swings below zero here.
    const { line } = momentumGeometry([0, 0, 40, 0, 0, 3, 0], 40, 32);

    for (const s of segments(line).segments) {
      const low = Math.min(s.from, s.to);
      const high = Math.max(s.from, s.to);
      // In SVG space y grows downwards, so the baseline is the LARGEST y:
      // control points outside their segment's range are an overshoot.
      expect(s.c1).toBeGreaterThanOrEqual(low - 1e-9);
      expect(s.c1).toBeLessThanOrEqual(high + 1e-9);
      expect(s.c2).toBeGreaterThanOrEqual(low - 1e-9);
      expect(s.c2).toBeLessThanOrEqual(high + 1e-9);
    }
  });

  it("scales every row against the shared ceiling, not its own", ({
    expect,
  }) => {
    // The same counts under a higher ceiling sit lower: a quiet project
    // reads as quiet next to a busy one.
    const alone = momentumGeometry([1, 2], 2, 32);
    const beside = momentumGeometry([1, 2], 20, 32);

    expect(beside.points[1]![1]).toBeGreaterThan(alone.points[1]![1]);
  });

  it("spans the full width and closes the area on the baseline", ({
    expect,
  }) => {
    const { points, area } = momentumGeometry([1, 2, 3], 3, 32);

    expect(points[0]![0]).toBe(0);
    expect(points[2]![0]).toBe(100);
    expect(area.endsWith("L100,32 L0,32 Z")).toBe(true);
  });

  it("draws a single point as a move and nothing as nothing", ({ expect }) => {
    expect(monotonePath([])).toBe("");
    expect(monotonePath([[0, 5]])).toBe("M0,5");
  });
});

describe("momentum delta", () => {
  it("compares the last seven days with the seven before", ({ expect }) => {
    const counts = [...Array(7).fill(1), ...Array(7).fill(2)];

    expect(momentumDelta(counts)).toBe(100);
  });

  it("says nothing when the earlier week was empty", ({ expect }) => {
    const counts = [...Array(7).fill(0), ...Array(7).fill(5)];

    expect(momentumDelta(counts)).toBeUndefined();
  });

  it("goes negative when the project slows down", ({ expect }) => {
    const counts = [...Array(7).fill(4), ...Array(7).fill(1)];

    expect(momentumDelta(counts)).toBe(-75);
  });
});
