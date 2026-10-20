import type { AnalyticsQuery } from "../schemas/analyticsQuerySchema.ts";

/**
 * `orderBy` and `limit`, applied in JavaScript after every tier is merged.
 *
 * Never in SQL: `orderBy.key` is caller-supplied, and a `limit` applied per
 * tier would drop a row that only belongs in the true top-N once the tiers
 * are combined. Numbers sort numerically, anything else as a string, and a
 * `null` (a gauge fold over buckets with no reading) sorts last in both
 * directions, so a leaderboard never opens on an empty row.
 */
export class AnalyticsOrdering {
  public static apply<T extends Record<string, unknown>>(
    rows: T[],
    query: Pick<AnalyticsQuery, "orderBy" | "limit">,
  ): T[] {
    let out = rows;
    if (query.orderBy) {
      const { key, direction } = query.orderBy;
      out = [...rows].sort((a, b) =>
        AnalyticsOrdering.compare(a[key], b[key], direction),
      );
    }
    if (query.limit !== undefined) out = out.slice(0, query.limit);
    return out;
  }

  public static compare(
    left: unknown,
    right: unknown,
    direction: "asc" | "desc",
  ): number {
    const leftMissing = left === null || left === undefined;
    const rightMissing = right === null || right === undefined;
    if (leftMissing || rightMissing) {
      return leftMissing === rightMissing ? 0 : leftMissing ? 1 : -1;
    }
    const comparison =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left as string | number).localeCompare(
            String(right as string | number),
          );
    return direction === "desc" ? -comparison : comparison;
  }
}
