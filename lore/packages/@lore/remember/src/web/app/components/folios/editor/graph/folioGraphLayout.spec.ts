import { describe, it } from "vitest";

import {
  FOLIO_GRAPH_ITERATIONS,
  createFolioGraphLayout,
  folioGraphBounds,
  stepFolioGraphLayout,
} from "./folioGraphLayout.ts";

const distance = (
  layout: ReturnType<typeof createFolioGraphLayout>,
  a: number,
  b: number,
) => Math.hypot(layout.x[a] - layout.x[b], layout.y[a] - layout.y[b]);

const run = (layout: ReturnType<typeof createFolioGraphLayout>) => {
  let done = false;
  let rounds = 0;
  while (!done && rounds < 1000) {
    done = stepFolioGraphLayout(layout, 25);
    rounds++;
  }
  return done;
};

/**
 * A project the size of Alepha's (#Q4438): a few hundred folios, most of
 * them linked, a handful of hubs every epic folio links to, a long tail of
 * small chains, and a hundred folios with no link at all.
 */
const largeGraph = () => {
  const count = 500;
  const edges: Array<[number, number]> = [];
  // Five hubs, forty spokes each.
  for (let hub = 0; hub < 5; hub++) {
    for (let s = 0; s < 40; s++) edges.push([hub, 5 + hub * 40 + s]);
  }
  // A tree over the next two hundred, hooked to the hubs.
  for (let i = 205; i < 400; i++)
    edges.push([i, Math.floor((i - 205) / 3) + 5]);
  // 400..499 are linked to nothing.
  return { count, edges };
};

describe("folioGraphLayout", () => {
  it("pulls linked folios closer than unlinked ones, and finishes", ({
    expect,
  }) => {
    // 0-1-2 a chain, 3 and 4 alone.
    const layout = createFolioGraphLayout(5, [
      [0, 1],
      [1, 2],
    ]);
    expect(run(layout)).toBe(true);
    expect(layout.iteration).toBe(FOLIO_GRAPH_ITERATIONS);
    expect(distance(layout, 0, 1)).toBeLessThan(distance(layout, 0, 3));
    for (let i = 0; i < 5; i++) {
      expect(Number.isFinite(layout.x[i])).toBe(true);
      expect(Number.isFinite(layout.y[i])).toBe(true);
    }
  });

  it("lays out a graph with no link at all in one go", ({ expect }) => {
    const layout = createFolioGraphLayout(9, []);
    expect(layout.iteration).toBe(FOLIO_GRAPH_ITERATIONS);
    expect(stepFolioGraphLayout(layout, 4)).toBe(true);
    const bounds = folioGraphBounds(layout)!;
    // A three by three block, not a ring.
    expect(bounds.maxX - bounds.minX).toBeLessThan(100);
    expect(bounds.maxY - bounds.minY).toBeLessThan(100);
  });

  it("lays out five hundred folios fast, a slice well under a frame", ({
    expect,
  }) => {
    const { count, edges } = largeGraph();
    const layout = createFolioGraphLayout(count, edges);
    const started = performance.now();
    const slices: number[] = [];
    let done = false;
    while (!done) {
      const slice = performance.now();
      // The view runs two iterations at a time, until its 8 ms budget.
      done = stepFolioGraphLayout(layout, 2);
      slices.push(performance.now() - slice);
    }
    slices.sort((a, b) => a - b);
    // The median, not the slowest: a garbage collection on a loaded runner
    // can stall any one slice. Locally a slice is well under 1 ms and the
    // whole layout under 100 ms.
    expect(slices[Math.floor(slices.length / 2)]).toBeLessThan(8);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("leaves no two dots of a few-hundred-folio graph on top of each other", ({
    expect,
  }) => {
    const { count, edges } = largeGraph();
    const layout = createFolioGraphLayout(count, edges);
    expect(run(layout)).toBe(true);
    let overlaps = 0;
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        if (distance(layout, i, j) < layout.radius[i] + layout.radius[j]) {
          overlaps++;
        }
      }
    }
    expect(overlaps).toBe(0);
  });

  it("keeps every call bounded and separates a hub with six hundred neighbours", ({
    expect,
  }) => {
    const edges: Array<[number, number]> = [];
    for (let s = 1; s <= 600; s++) edges.push([0, s]);
    const layout = createFolioGraphLayout(601, edges);
    const slices: number[] = [];
    let done = false;
    while (!done) {
      const slice = performance.now();
      done = stepFolioGraphLayout(layout, 2);
      slices.push(performance.now() - slice);
    }
    slices.sort((a, b) => a - b);
    // The separation runs a few passes per call too: no single call holds
    // the thread for the whole of it.
    expect(slices[Math.floor(slices.length / 2)]).toBeLessThan(8);
    let overlaps = 0;
    for (let i = 0; i <= 600; i++) {
      for (let j = i + 1; j <= 600; j++) {
        if (distance(layout, i, j) < layout.radius[i] + layout.radius[j]) {
          overlaps++;
        }
      }
    }
    expect(overlaps).toBe(0);
  });

  it("packs the unlinked folios in a compact block beside the cluster", ({
    expect,
  }) => {
    const { count, edges } = largeGraph();
    const layout = createFolioGraphLayout(count, edges);
    run(layout);
    const cluster = folioGraphBounds(layout, (i) => layout.linked[i] === 1)!;
    const lone = folioGraphBounds(layout, (i) => layout.linked[i] === 0)!;
    // Beside it, not around it.
    expect(lone.minX).toBeGreaterThan(cluster.maxX);
    // A hundred dots in a block: its area is about theirs, not a ring's.
    const area = (lone.maxX - lone.minX) * (lone.maxY - lone.minY);
    expect(area).toBeLessThan(100 * 30 * 30 * 2);
    // The hub's spokes are spread around it, not piled on it.
    for (let s = 5; s < 45; s++) {
      expect(distance(layout, 0, s)).toBeGreaterThan(
        layout.radius[0] + layout.radius[s],
      );
    }
  });
});
