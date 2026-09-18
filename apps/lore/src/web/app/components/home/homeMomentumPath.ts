/**
 * The momentum sparkline's geometry: the points, the smoothed line through
 * them, and the area under it, in a `100 x height` box.
 *
 * Plain functions of the counts, kept out of the component so the curve can
 * be checked without rendering anything.
 */
export interface MomentumGeometry {
  /**
   * One `[x, y]` per day, x in `0..100`, y in `0..height` (0 at the top).
   */
  points: Array<[number, number]>;
  /**
   * The line through every point, as an SVG path.
   */
  line: string;
  /**
   * The same line closed down to the baseline, for the fill under it.
   */
  area: string;
}

/**
 * Lay the counts out against `ceiling`, the busiest day across the whole
 * table, so every row shares one scale and a quiet project reads as quiet.
 *
 * `inset` keeps the line's own stroke and the end dot off the box's top and
 * bottom edges, where they would be cut in half.
 */
export const momentumGeometry = (
  counts: number[],
  ceiling: number,
  height: number,
  inset = 3,
): MomentumGeometry => {
  const top = inset;
  const bottom = height - inset;
  const max = Math.max(ceiling, 1);
  const step = counts.length > 1 ? 100 / (counts.length - 1) : 0;
  const points = counts.map(
    (count, index) =>
      [index * step, bottom - (count / max) * (bottom - top)] as [
        number,
        number,
      ],
  );
  const line = monotonePath(points);
  const area =
    points.length > 0
      ? `${line} L${points[points.length - 1]![0]},${height} L${points[0]![0]},${height} Z`
      : "";
  return { points, line, area };
};

/**
 * A smooth curve through every point that never overshoots them: monotone
 * cubic interpolation (Fritsch-Carlson), the curve d3 calls `curveMonotoneX`.
 *
 * Monotone rather than a plain spline because a spline swings past its
 * points: between a busy day and an empty one it would dip below the
 * baseline, drawing a negative number of events. Here each segment stays
 * between its two ends, so the curve only ever says what the counts say.
 */
export const monotonePath = (points: Array<[number, number]>): string => {
  const n = points.length;
  if (n === 0) return "";
  const [x0, y0] = points[0]!;
  if (n === 1) return `M${x0},${y0}`;

  // The secant slope of each segment.
  const secants: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const [xa, ya] = points[i]!;
    const [xb, yb] = points[i + 1]!;
    secants.push((yb - ya) / (xb - xa));
  }

  // The tangent at each point: the ends take their segment's slope, an
  // interior point the mean of its two, and a local extremum a flat one.
  const tangents = points.map((_, i) => {
    if (i === 0) return secants[0]!;
    if (i === n - 1) return secants[n - 2]!;
    const before = secants[i - 1]!;
    const after = secants[i]!;
    return before * after <= 0 ? 0 : (before + after) / 2;
  });

  // Fritsch-Carlson: scale down any pair of tangents steep enough to make
  // their segment overshoot.
  for (let i = 0; i < n - 1; i++) {
    const secant = secants[i]!;
    if (secant === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i]! / secant;
    const b = tangents[i + 1]! / secant;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      tangents[i] = t * a * secant;
      tangents[i + 1] = t * b * secant;
    }
  }

  let d = `M${x0},${y0}`;
  for (let i = 0; i < n - 1; i++) {
    const [xa, ya] = points[i]!;
    const [xb, yb] = points[i + 1]!;
    const h = (xb - xa) / 3;
    d += ` C${xa + h},${ya + tangents[i]! * h} ${xb - h},${yb - tangents[i + 1]! * h} ${xb},${yb}`;
  }
  return d;
};

/**
 * How the recent half of the window compares with the half before it, in
 * whole percent: the last seven days against the seven before them.
 *
 * `undefined` when the earlier half has no events at all, where any growth
 * is infinite and a percentage would be noise.
 */
export const momentumDelta = (counts: number[]): number | undefined => {
  const half = Math.floor(counts.length / 2);
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const before = sum(
    counts.slice(counts.length - 2 * half, counts.length - half),
  );
  const recent = sum(counts.slice(counts.length - half));
  if (before === 0) return undefined;
  return Math.round(((recent - before) / before) * 100);
};
