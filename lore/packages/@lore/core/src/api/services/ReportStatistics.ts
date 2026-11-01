/**
 * The order statistics every report reads time-shaped figures through
 * (#E108): medians and p85, never means, since one old quest skews a mean and
 * cannot move a median.
 *
 * Folded in memory on purpose: neither SQLite nor D1 has `percentile_cont`, and
 * a window function per figure would still read every row these do.
 */
export class ReportStatistics {
  /**
   * The value at percentile `p` (0-100) of `values`, nearest rank: always a
   * value that was measured. Zero for no values, which a caller shows as "no
   * data" rather than as a figure.
   */
  percentile(values: readonly number[], p: number): number {
    if (values.length === 0) {
      return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.max(rank - 1, 0)]!;
  }

  /**
   * The middle value, the mean of the two middle ones for an even count.
   */
  median(values: readonly number[]): number {
    if (values.length === 0) {
      return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[middle]!
      : (sorted[middle - 1]! + sorted[middle]!) / 2;
  }
}
