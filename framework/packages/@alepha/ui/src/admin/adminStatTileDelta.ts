/**
 * What a stat tile's delta chip says, worked out from the two numbers it
 * compares.
 *
 * - `percent`: the change, rounded to a whole percent, signed.
 * - `new`: the previous value was 0 and the current one is not, where a
 *   percentage would be infinite.
 * - `flat`: both are 0, which is no change rather than an undefined one.
 */
export type AdminStatTileDeltaChange =
  | { kind: "percent"; percent: number }
  | { kind: "new" }
  | { kind: "flat" };

/**
 * The change from `previous` to `current`, as the tile's chip shows it.
 *
 * A pure function so the maths has its own spec: the chip is the one part of
 * a tile a reader acts on, and "+Infinity%" or "NaN%" for a quiet week is the
 * kind of thing a render test never notices.
 */
export const adminStatTileDelta = (
  current: number,
  previous: number,
): AdminStatTileDeltaChange => {
  if (previous === 0) {
    return current === 0 ? { kind: "flat" } : { kind: "new" };
  }
  const percent = Math.round(((current - previous) / previous) * 100);
  // `Math.round(-0.4)` is `-0`, which would print as "-0%".
  return percent === 0 ? { kind: "flat" } : { kind: "percent", percent };
};

/**
 * The chip's text: `+12%`, `-3%`, `0%`, or the localised word for `new`.
 */
export const formatAdminStatTileDelta = (
  change: AdminStatTileDeltaChange,
  newLabel: string,
): string => {
  if (change.kind === "new") {
    return newLabel;
  }
  if (change.kind === "flat") {
    return "0%";
  }
  return `${change.percent > 0 ? "+" : ""}${change.percent}%`;
};
