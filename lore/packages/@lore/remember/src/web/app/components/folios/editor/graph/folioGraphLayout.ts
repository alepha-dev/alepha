/**
 * A force layout for the folio graph (#Q4262), run a few iterations at a
 * time so a project with hundreds of folios lays out over several frames
 * instead of freezing one.
 *
 * Fruchterman-Reingold on a unit-free plane: every pair repels, every edge
 * pulls, a weak gravity keeps islands on screen, and the temperature that
 * caps each move cools to nothing over `FOLIO_GRAPH_ITERATIONS`. The start
 * is a deterministic spiral, so the same graph lays out the same way.
 */

export interface FolioGraphLayout {
  x: Float64Array;
  y: Float64Array;
  edges: Array<[number, number]>;
  iteration: number;
}

export const FOLIO_GRAPH_ITERATIONS = 300;

/**
 * Ideal edge length, in layout units.
 */
const K = 40;

export const createFolioGraphLayout = (
  count: number,
  edges: Array<[number, number]>,
): FolioGraphLayout => {
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  // A sunflower spiral: spread evenly, no two nodes on the same spot.
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const r = K * Math.sqrt(i + 1);
    x[i] = r * Math.cos(i * golden);
    y[i] = r * Math.sin(i * golden);
  }
  return { x, y, edges, iteration: 0 };
};

/**
 * Advances the layout by up to `steps` iterations; returns whether it is
 * done.
 */
export const stepFolioGraphLayout = (
  layout: FolioGraphLayout,
  steps: number,
): boolean => {
  const { x, y, edges } = layout;
  const n = x.length;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const end = Math.min(FOLIO_GRAPH_ITERATIONS, layout.iteration + steps);
  for (; layout.iteration < end; layout.iteration++) {
    const temperature =
      K * 2 * (1 - layout.iteration / FOLIO_GRAPH_ITERATIONS) + 0.5;
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ex = x[i] - x[j];
        let ey = y[i] - y[j];
        let d2 = ex * ex + ey * ey;
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
    for (let i = 0; i < n; i++) {
      // Gravity toward the centre, so an unlinked folio does not drift off.
      dx[i] -= x[i] * 0.02;
      dy[i] -= y[i] * 0.02;
      const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
      if (d > 0) {
        const move = Math.min(d, temperature);
        x[i] += (dx[i] / d) * move;
        y[i] += (dy[i] / d) * move;
      }
    }
  }
  return layout.iteration >= FOLIO_GRAPH_ITERATIONS;
};
