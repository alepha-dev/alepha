/**
 * A force layout for the folio graph (#Q4262, #Q4438), run in slices so a
 * project with hundreds of folios lays out without freezing the page.
 *
 * Fruchterman-Reingold on a unit-free plane, in its grid variant: a folio
 * is repelled only by the folios within `CUTOFF`, found through a grid of
 * cells that size, so an iteration costs about O(n + edges) rather than
 * O(n²). Every edge pulls, a weak gravity keeps islands together, and the
 * temperature that caps each move cools to nothing over
 * `FOLIO_GRAPH_ITERATIONS`. The last iterations also push apart any two
 * dots closer than their radii, so a hub's neighbours never pile into one
 * blob.
 *
 * Only linked folios take part in the simulation. The unlinked ones are
 * packed afterwards into a compact block beside the linked cluster, rather
 * than being pushed by everything else into a wide ring around it.
 *
 * The start is a deterministic spiral, so the same graph lays out the same
 * way.
 */

export interface FolioGraphLayout {
  x: Float64Array;
  y: Float64Array;
  /**
   * Each folio's dot radius, in layout units: no two dots are closer than
   * the sum of theirs (plus `GAP`) once the layout is done.
   */
  radius: Float64Array;
  /**
   * Whether each folio has at least one link.
   */
  linked: Uint8Array;
  edges: Array<[number, number]>;
  iteration: number;
  /**
   * Separation passes run after the last iteration, and whether the layout
   * is finished: no overlap left (or the passes ran out) and the unlinked
   * folios placed.
   */
  passes: number;
  done: boolean;
}

export const FOLIO_GRAPH_ITERATIONS = 300;

/**
 * Ideal edge length, in layout units.
 */
const K = 40;

/**
 * Two folios further apart than this do not repel each other; it is also
 * the side of a grid cell, so the folios that may repel one are in its
 * cell or the eight around it.
 */
const CUTOFF = K * 3;

/**
 * The free space kept between two dots, in layout units.
 */
const GAP = 6;

/**
 * The share of the iterations, at the end, that also separate overlapping
 * dots.
 */
const COLLIDE_FROM = 0.6;

/**
 * The most separation passes run once the simulation is done, a few per
 * call like the iterations, stopping at the first that moves nothing.
 */
const FINAL_COLLISION_PASSES = 300;

/**
 * A dot's radius in layout units: a little larger for a better linked folio.
 */
const radiusFor = (degree: number) => 6 + Math.min(6, degree) * 1.2;

export const createFolioGraphLayout = (
  count: number,
  edges: Array<[number, number]>,
): FolioGraphLayout => {
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  const radius = new Float64Array(count);
  const linked = new Uint8Array(count);
  const degree = new Uint16Array(count);
  for (const [a, b] of edges) {
    linked[a] = 1;
    linked[b] = 1;
    degree[a]++;
    degree[b]++;
  }
  // A sunflower spiral over the linked folios: spread evenly, no two nodes
  // on the same spot.
  const golden = Math.PI * (3 - Math.sqrt(5));
  let k = 0;
  for (let i = 0; i < count; i++) {
    radius[i] = radiusFor(degree[i]);
    if (!linked[i]) continue;
    const r = K * 0.8 * Math.sqrt(k + 1);
    x[i] = r * Math.cos(k * golden);
    y[i] = r * Math.sin(k * golden);
    k++;
  }
  const layout = {
    x,
    y,
    radius,
    linked,
    edges,
    iteration: 0,
    passes: 0,
    done: false,
  };
  if (k === 0) {
    // Nothing to simulate: the unlinked block is the whole picture.
    layout.iteration = FOLIO_GRAPH_ITERATIONS;
    layout.done = true;
    placeUnlinked(layout);
  }
  return layout;
};

/**
 * Advances the layout by up to `steps` iterations, or once they are over by
 * up to `steps` separation passes; returns whether it is done. Every call
 * does a bounded amount of work, so a caller slicing by time stays within
 * its budget even on a hub with hundreds of neighbours. The call that
 * finishes also places the unlinked folios.
 */
export const stepFolioGraphLayout = (
  layout: FolioGraphLayout,
  steps: number,
): boolean => {
  if (layout.done) return true;
  const { x, y, edges, linked } = layout;
  const n = x.length;
  const nodes: number[] = [];
  for (let i = 0; i < n; i++) if (linked[i]) nodes.push(i);
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const grid = new Map<number, number[]>();
  const simulating = layout.iteration < FOLIO_GRAPH_ITERATIONS;
  const end = Math.min(FOLIO_GRAPH_ITERATIONS, layout.iteration + steps);
  for (; layout.iteration < end; layout.iteration++) {
    const progress = layout.iteration / FOLIO_GRAPH_ITERATIONS;
    const temperature = K * 2 * (1 - progress) + 0.5;
    dx.fill(0);
    dy.fill(0);
    fillGrid(layout, nodes, grid);
    for (const i of nodes) {
      const gx = Math.floor(x[i] / CUTOFF);
      const gy = Math.floor(y[i] / CUTOFF);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const cell = grid.get(cellKey(gx + ox, gy + oy));
          if (!cell) continue;
          for (const j of cell) {
            // Each pair once: the lower index applies both sides.
            if (j <= i) continue;
            let ex = x[i] - x[j];
            let ey = y[i] - y[j];
            let d2 = ex * ex + ey * ey;
            if (d2 >= CUTOFF * CUTOFF) continue;
            if (d2 < 0.01) {
              ex = 0.1 * ((i % 7) - 3) || 0.1;
              ey = 0.1;
              d2 = ex * ex + ey * ey;
            }
            // Repulsion k²/d along the unit vector: k²/d² times the offset.
            const f = (K * K) / d2;
            dx[i] += ex * f;
            dy[i] += ey * f;
            dx[j] -= ex * f;
            dy[j] -= ey * f;
          }
        }
      }
    }
    for (const [a, b] of edges) {
      const ex = x[a] - x[b];
      const ey = y[a] - y[b];
      const d = Math.sqrt(ex * ex + ey * ey) || 0.01;
      // Attraction d²/k along the unit vector: d/k times the offset.
      const f = d / K;
      dx[a] -= ex * f;
      dy[a] -= ey * f;
      dx[b] += ex * f;
      dy[b] += ey * f;
    }
    for (const i of nodes) {
      // Gravity toward the centre, so a linked island does not drift off.
      dx[i] -= x[i] * 0.03;
      dy[i] -= y[i] * 0.03;
      const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
      if (d > 0) {
        const move = Math.min(d, temperature);
        x[i] += (dx[i] / d) * move;
        y[i] += (dy[i] / d) * move;
      }
    }
    if (progress >= COLLIDE_FROM) separate(layout, nodes, grid);
  }
  // A call that ran iterations stops there, so it does no more work than
  // `steps` of them: the separation starts on the next call.
  if (simulating) return false;
  for (let pass = 0; pass < steps; pass++) {
    if (
      layout.passes >= FINAL_COLLISION_PASSES ||
      !separate(layout, nodes, grid)
    ) {
      layout.done = true;
      placeUnlinked(layout);
      return true;
    }
    layout.passes++;
  }
  return false;
};

/**
 * The bounding box of the folios `include` keeps, in layout units, dots
 * included; undefined when it keeps none.
 */
export const folioGraphBounds = (
  layout: FolioGraphLayout,
  include: (index: number) => boolean = () => true,
) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < layout.x.length; i++) {
    if (!include(i)) continue;
    const r = layout.radius[i];
    minX = Math.min(minX, layout.x[i] - r);
    minY = Math.min(minY, layout.y[i] - r);
    maxX = Math.max(maxX, layout.x[i] + r);
    maxY = Math.max(maxY, layout.y[i] + r);
  }
  if (minX === Infinity) return undefined;
  return { minX, minY, maxX, maxY };
};

/**
 * A grid cell's key: two signed 16-bit cell coordinates in one number.
 */
const cellKey = (gx: number, gy: number) => (gx + 32768) * 65536 + gy + 32768;

const fillGrid = (
  layout: FolioGraphLayout,
  nodes: number[],
  grid: Map<number, number[]>,
) => {
  grid.clear();
  for (const i of nodes) {
    const key = cellKey(
      Math.floor(layout.x[i] / CUTOFF),
      Math.floor(layout.y[i] / CUTOFF),
    );
    const cell = grid.get(key);
    if (cell) cell.push(i);
    else grid.set(key, [i]);
  }
};

/**
 * One pass pushing apart every two dots closer than their radii and `GAP`,
 * each by half the overlap; returns whether any pair overlapped.
 */
const separate = (
  layout: FolioGraphLayout,
  nodes: number[],
  grid: Map<number, number[]>,
): boolean => {
  const { x, y, radius } = layout;
  fillGrid(layout, nodes, grid);
  let overlapped = false;
  for (const i of nodes) {
    const gx = Math.floor(x[i] / CUTOFF);
    const gy = Math.floor(y[i] / CUTOFF);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const cell = grid.get(cellKey(gx + ox, gy + oy));
        if (!cell) continue;
        for (const j of cell) {
          if (j <= i) continue;
          const min = radius[i] + radius[j] + GAP;
          let ex = x[i] - x[j];
          let ey = y[i] - y[j];
          let d = Math.sqrt(ex * ex + ey * ey);
          if (d >= min) continue;
          overlapped = true;
          if (d < 0.01) {
            ex = ((i % 7) - 3) * 0.1 || 0.1;
            ey = 0.1;
            d = Math.sqrt(ex * ex + ey * ey);
          }
          // A hair more than half each, so the pass converges.
          const push = ((min - d) / d) * 0.51;
          x[i] += ex * push;
          y[i] += ey * push;
          x[j] -= ex * push;
          y[j] -= ey * push;
        }
      }
    }
  }
  return overlapped;
};

/**
 * Packs the unlinked folios in rows, in a block about as tall as the linked
 * cluster, to its right; alone, in a square centred on the origin.
 */
const placeUnlinked = (layout: FolioGraphLayout) => {
  const { x, y, radius, linked } = layout;
  const lone: number[] = [];
  for (let i = 0; i < x.length; i++) if (!linked[i]) lone.push(i);
  if (lone.length === 0) return;
  const pitch = 2 * radiusFor(0) + GAP + 4;
  const cluster = folioGraphBounds(layout, (i) => linked[i] === 1);
  let rows = Math.ceil(Math.sqrt(lone.length));
  let left = -((Math.ceil(lone.length / rows) - 1) * pitch) / 2;
  let top = -((rows - 1) * pitch) / 2;
  if (cluster) {
    // As tall as the cluster, but never a single column a mile long.
    const tall = Math.max(1, Math.floor((cluster.maxY - cluster.minY) / pitch));
    rows = Math.min(lone.length, Math.max(rows, tall));
    left = cluster.maxX + K * 2 + radius[lone[0]];
    top = (cluster.minY + cluster.maxY) / 2 - ((rows - 1) * pitch) / 2;
  }
  lone.forEach((i, k) => {
    x[i] = left + Math.floor(k / rows) * pitch;
    y[i] = top + (k % rows) * pitch;
  });
};
