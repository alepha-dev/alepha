/**
 * One point of a series, placed on a 0-100 box.
 */
export interface DashboardScaledPoint {
  x: number;
  y: number;
}

/**
 * Place a series on a 0-100 box, to scale.
 *
 * ⚠️ **The baseline is zero, never the series' own minimum.** A sparkline
 * that starts its axis at the lowest reading turns 98 to 100 into a cliff;
 * a dashboard must not draw a calm fortnight as a crisis. A series whose
 * every reading is zero lies flat on the floor.
 *
 * `y` grows downwards, as SVG does.
 */
export const scaleSeries = (
  values: number[],
): { points: DashboardScaledPoint[]; max: number } => {
  const max = Math.max(0, ...values);
  const span = values.length > 1 ? values.length - 1 : 1;
  const points = values.map((value, index) => ({
    x: values.length > 1 ? (index / span) * 100 : 50,
    y: max > 0 ? 100 - (Math.max(0, value) / max) * 100 : 100,
  }));
  return { points, max };
};

/**
 * Where an instant falls along a series' time axis, 0-100, or `undefined`
 * when it is outside it: a marker outside the window is not drawn at the
 * edge, where it would claim a date it does not have.
 */
export const markerPosition = (
  at: string,
  first: string,
  last: string,
): number | undefined => {
  const start = Date.parse(first);
  const end = Date.parse(last);
  const when = Date.parse(at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return undefined;
  }
  if (!Number.isFinite(when) || when < start || when > end) {
    return undefined;
  }
  return ((when - start) / (end - start)) * 100;
};
