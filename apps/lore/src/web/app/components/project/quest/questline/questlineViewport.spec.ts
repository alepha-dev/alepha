import { describe, expect, it } from "vitest";

import {
  FIT_PADDING,
  MAX_SCALE,
  MIN_SCALE,
  QuestlineViewport,
  type ViewportTransform,
} from "./questlineViewport.ts";

/**
 * The board point under a viewport point: the invariant a cursor-anchored
 * zoom has to hold.
 */
const under = (t: ViewportTransform, p: { x: number; y: number }) => ({
  x: (p.x - t.tx) / t.k,
  y: (p.y - t.ty) / t.k,
});

describe("QuestlineViewport", () => {
  const viewport = new QuestlineViewport();
  const frame = { width: 1000, height: 600 };

  describe("clamp", () => {
    it("holds the scale between the two bounds", () => {
      expect(viewport.clamp(0.01)).toBe(MIN_SCALE);
      expect(viewport.clamp(9)).toBe(MAX_SCALE);
      expect(viewport.clamp(1.5)).toBe(1.5);
    });
  });

  describe("fit", () => {
    it("shrinks a board wider than the frame and centres it vertically", () => {
      const t = viewport.fit(frame, { width: 1920, height: 100 });

      expect(t.k).toBeCloseTo(960 / 1920);
      expect(t.tx).toBeCloseTo(FIT_PADDING);
      expect(t.ty).toBeCloseTo((600 - 100 * t.k) / 2);
    });

    it("shrinks a board taller than the frame and centres it horizontally", () => {
      const t = viewport.fit(frame, { width: 100, height: 1120 });

      expect(t.k).toBeCloseTo(560 / 1120);
      expect(t.ty).toBeCloseTo(FIT_PADDING);
      expect(t.tx).toBeCloseTo((1000 - 100 * t.k) / 2);
    });

    it("never enlarges a board that already fits, and centres it", () => {
      const t = viewport.fit(frame, { width: 400, height: 200 });

      expect(t.k).toBe(1);
      expect(t.tx).toBe(300);
      expect(t.ty).toBe(200);
    });

    it("stops at the smallest scale and starts the board at its top-left", () => {
      const t = viewport.fit(frame, { width: 10000, height: 100 });

      expect(t.k).toBe(MIN_SCALE);
      expect(t.tx).toBe(FIT_PADDING);
      // 100 * 0.25 = 25 still fits, so that axis stays centred.
      expect(t.ty).toBeCloseTo((600 - 25) / 2);
    });

    it("is the identity while nothing has been measured", () => {
      expect(
        viewport.fit({ width: 0, height: 0 }, { width: 500, height: 500 }),
      ).toEqual(viewport.identity);
      expect(viewport.fit(frame, { width: 0, height: 0 })).toEqual(
        viewport.identity,
      );
    });
  });

  describe("zoomAt", () => {
    it("keeps the board point under the cursor where it is", () => {
      const before = { k: 1, tx: 40, ty: 30 };
      const cursor = { x: 300, y: 200 };

      const after = viewport.zoomAt(before, 1.5, cursor.x, cursor.y);

      expect(after.k).toBe(1.5);
      expect(under(after, cursor).x).toBeCloseTo(under(before, cursor).x);
      expect(under(after, cursor).y).toBeCloseTo(under(before, cursor).y);
    });

    it("holds the anchor through a zoom out as well", () => {
      const before = { k: 1.6, tx: -120, ty: -80 };
      const cursor = { x: 500, y: 300 };

      const after = viewport.zoomAt(before, 0.5, cursor.x, cursor.y);

      expect(after.k).toBeCloseTo(0.8);
      expect(under(after, cursor).x).toBeCloseTo(under(before, cursor).x);
      expect(under(after, cursor).y).toBeCloseTo(under(before, cursor).y);
    });

    it("returns the same transform once a bound is reached", () => {
      const ceiling = { k: MAX_SCALE, tx: 0, ty: 0 };
      const floor = { k: MIN_SCALE, tx: 0, ty: 0 };

      expect(viewport.zoomAt(ceiling, 2, 10, 10)).toBe(ceiling);
      expect(viewport.zoomAt(floor, 0.5, 10, 10)).toBe(floor);
    });

    it("clamps a step that overshoots rather than refusing it", () => {
      const t = viewport.zoomAt({ k: 1.9, tx: 0, ty: 0 }, 1.2, 0, 0);

      expect(t.k).toBe(MAX_SCALE);
    });
  });

  describe("panBy", () => {
    it("moves by the delta and keeps the scale", () => {
      expect(viewport.panBy({ k: 0.5, tx: 10, ty: 20 }, 5, -7)).toEqual({
        k: 0.5,
        tx: 15,
        ty: 13,
      });
    });

    it("returns the same transform for a zero delta", () => {
      const t = { k: 1, tx: 0, ty: 0 };

      expect(viewport.panBy(t, 0, 0)).toBe(t);
    });
  });

  describe("panTo", () => {
    const t = { k: 1, tx: 0, ty: 0 };

    it("leaves a rect that is already inside alone", () => {
      expect(
        viewport.panTo(t, { x: 100, y: 100, width: 200, height: 100 }, frame),
      ).toBe(t);
    });

    it("pulls a rect past the right edge back inside, padding included", () => {
      const moved = viewport.panTo(
        t,
        { x: 900, y: 100, width: 200, height: 100 },
        frame,
      );

      // The right edge at 1100 has to land on 1000 minus the padding.
      expect(moved.tx).toBe(-(1100 - (1000 - FIT_PADDING)));
      expect(moved.ty).toBe(0);
    });

    it("pushes a rect past the top-left edge back inside", () => {
      const moved = viewport.panTo(
        t,
        { x: -50, y: -30, width: 200, height: 100 },
        frame,
      );

      expect(moved.tx).toBe(FIT_PADDING + 50);
      expect(moved.ty).toBe(FIT_PADDING + 30);
    });

    it("aligns a rect larger than the frame on its leading edge", () => {
      const moved = viewport.panTo(
        t,
        { x: 500, y: 0, width: 3000, height: 100 },
        frame,
      );

      // It cannot fit, so the most that helps is its left edge at the padding.
      expect(moved.tx).toBe(-(500 - FIT_PADDING));
    });

    it("keeps the scale it was given", () => {
      const zoomed = { k: 1.5, tx: 10, ty: 10 };

      const moved = viewport.panTo(
        zoomed,
        { x: 950, y: 50, width: 100, height: 50 },
        frame,
      );

      expect(moved.k).toBe(1.5);
    });
  });

  describe("wheel", () => {
    it("reads pixels as they are, lines as sixteen pixels, pages as the frame", () => {
      expect(viewport.wheelPixels(120, 0, 600)).toBe(120);
      expect(viewport.wheelPixels(3, 1, 600)).toBe(48);
      expect(viewport.wheelPixels(1, 2, 600)).toBe(600);
    });

    it("shrinks on wheel down, grows on wheel up, and the two cancel", () => {
      expect(viewport.wheelZoomFactor(100, 0)).toBeLessThan(1);
      expect(viewport.wheelZoomFactor(-100, 0)).toBeGreaterThan(1);
      expect(
        viewport.wheelZoomFactor(100, 0) * viewport.wheelZoomFactor(-100, 0),
      ).toBeCloseTo(1);
    });

    it("treats a line notch as more than a pixel notch of the same number", () => {
      expect(viewport.wheelZoomFactor(3, 1)).toBeLessThan(
        viewport.wheelZoomFactor(3, 0),
      );
    });
  });
});
