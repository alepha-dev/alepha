/**
 * The momentum column's geometry: one bar height per day, in pixels.
 *
 * Plain functions of the counts, kept out of the component so the scale can
 * be checked without rendering anything.
 */

/**
 * The height a day with no events keeps, in pixels: a hairline on the
 * baseline rather than nothing at all, so the empty days still read as days
 * and the window keeps its width.
 */
export const EMPTY_BAR = 1;

/**
 * The height any day with at least one event gets, in pixels, however small
 * its share of the ceiling: a bar rounded down to the baseline would say
 * "nothing happened", which is a different answer from "one thing did".
 */
export const MIN_BAR = 2;

/**
 * Lay the counts out against `ceiling`, the busiest day across the whole
 * table, so every row shares one scale and a quiet project reads as quiet.
 *
 * A per-row scale would give a project with two events a week the same
 * silhouette as one with two hundred, which reads as "equally busy" at a
 * glance and is the opposite of what the column is for. The cost is that
 * quiet projects are nearly flat, which is the true answer.
 */
export const momentumBarHeights = (
  counts: number[],
  ceiling: number,
  height: number,
): number[] => {
  const max = Math.max(ceiling, 1);
  return counts.map((count) => {
    if (count <= 0) return EMPTY_BAR;
    return Math.max(MIN_BAR, Math.round((count / max) * height));
  });
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
