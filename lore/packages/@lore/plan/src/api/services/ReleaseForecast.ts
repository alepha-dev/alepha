/**
 * When a release ships, from how fast the project actually goes (#Q3004): a
 * Monte Carlo over its recent weekly throughput.
 *
 * Each run replays weeks drawn from that history until the remaining quests
 * are done, so a bursty project gets a wide spread and a steady one a narrow
 * one, which an average of the same weeks would hide.
 *
 * ⚠️ Seeded, not `Math.random()`: the same history gives the same dates, so a
 * report does not change between two reloads for no reason, and a spec can
 * pin it.
 */
export class ReleaseForecast {
  protected readonly runs = 1000;

  /**
   * A week past which a run gives up: a project closing one quest a year must
   * not spin here.
   */
  protected readonly horizonWeeks = 520;

  /**
   * Weeks until `remaining` quests are done, at p50 and p85. Nothing when the
   * history holds no completion, which predicts nothing.
   */
  weeks(
    remaining: number,
    weeklyThroughput: readonly number[],
  ): { p50: number; p85: number } | undefined {
    if (remaining <= 0) {
      return { p50: 0, p85: 0 };
    }
    if (!weeklyThroughput.some((count) => count > 0)) {
      return undefined;
    }
    let state = 2_166_136_261;
    const next = () => {
      // Mulberry32: small, seedable, and well distributed enough for this.
      state = (state + 0x6d2b79f5) | 0;
      let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
      mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
    };

    const outcomes = Array.from({ length: this.runs }, () => {
      let left = remaining;
      let weeks = 0;
      while (left > 0 && weeks < this.horizonWeeks) {
        const draw = Math.floor(next() * weeklyThroughput.length);
        left -= weeklyThroughput[draw] ?? 0;
        weeks += 1;
      }
      return weeks;
    }).sort((a, b) => a - b);

    return {
      p50: outcomes[Math.ceil(0.5 * outcomes.length) - 1] ?? 0,
      p85: outcomes[Math.ceil(0.85 * outcomes.length) - 1] ?? 0,
    };
  }
}
