import { describe, it } from "vitest";

import {
  FOLIO_GRAPH_ITERATIONS,
  createFolioGraphLayout,
  stepFolioGraphLayout,
} from "./folioGraphLayout.ts";

const distance = (
  layout: ReturnType<typeof createFolioGraphLayout>,
  a: number,
  b: number,
) => Math.hypot(layout.x[a] - layout.x[b], layout.y[a] - layout.y[b]);

describe("folioGraphLayout", () => {
  it("pulls linked folios closer than unlinked ones, and finishes", ({
    expect,
  }) => {
    // 0-1-2 a chain, 3 and 4 alone.
    const layout = createFolioGraphLayout(5, [
      [0, 1],
      [1, 2],
    ]);
    let done = false;
    let rounds = 0;
    while (!done && rounds < 1000) {
      done = stepFolioGraphLayout(layout, 25);
      rounds++;
    }
    expect(done).toBe(true);
    expect(layout.iteration).toBe(FOLIO_GRAPH_ITERATIONS);
    expect(distance(layout, 0, 1)).toBeLessThan(distance(layout, 0, 3));
    for (let i = 0; i < 5; i++) {
      expect(Number.isFinite(layout.x[i])).toBe(true);
      expect(Number.isFinite(layout.y[i])).toBe(true);
    }
  });

  it("lays out five hundred folios in well under a second", ({ expect }) => {
    const edges: Array<[number, number]> = [];
    for (let i = 1; i < 500; i++) edges.push([i, Math.floor(i / 3)]);
    const layout = createFolioGraphLayout(500, edges);
    const started = performance.now();
    // One frame's worth, the way the view runs it.
    stepFolioGraphLayout(layout, 4);
    expect(performance.now() - started).toBeLessThan(250);
  });
});
