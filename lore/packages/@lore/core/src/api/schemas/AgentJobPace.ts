import type { AgentJobPaceValue } from "./agentJobPaceSchema.ts";

/**
 * What a running job's own pace says of the rest of its steps (#Q4436,
 * epic #E181): the time the steps left should take, as a range, and
 * whether they will fit before the job's timeout. A pure function, in
 * `@lore/core`'s browser-loadable schemas beside the steps, so the API,
 * MCP, the CLI and the page say the same thing.
 *
 * **Why the run's own pace.** Between runs a quest took 3 to 35 minutes;
 * inside a run the pace is steadier, so the run predicts itself better than
 * any history does (folio #F1556).
 *
 * **The range**, once 2 steps are done (`d` of `N`, the last at `t_last`,
 * `t` minutes elapsed, both from the job's start):
 * - low = `(N - d) × t_last / d`, the pace up to the last step;
 * - high = `(N - d) × t / d`, the pace with the time since the last step
 *   counted, so a stall widens the range instead of freezing it.
 *
 * The range is for the steps only: what follows the last quest (review,
 * checks, merge) took 1 to 56 minutes in the sample and is not in it.
 *
 * **The warning**: `t + low + allowance` past the ceiling. See
 * {@link ALLOWANCE_MINUTES} for the allowance.
 */
export class AgentJobPace {
  /**
   * The time counted for what follows the last quest: 30 minutes.
   *
   * The four real runs of the spec bound it. Above 24 minutes, or the
   * 21-quest run (timed out with 2 left, its review never started) loses
   * its warning at minute 60, where pace alone says the rest fits. Below
   * 59, or the 18-quest run (done at minute 54, 68 in all) gets one. In the
   * sample the time after the last quest was 7, 11, 14, 14, 48 and 56
   * minutes: 30 sits inside the window and covers four of those six.
   *
   * The elapsed-pace low end, `t × (N - d) / d`, was checked and rejected:
   * it warns on the 18-quest run at minute 13.
   */
  public static readonly ALLOWANCE_MINUTES = 30;

  /**
   * Steps done before a range is given: one step is no pace.
   */
  public static readonly MIN_STEPS = 2;

  /**
   * The range and the warning, in minutes. `stepTimes` are the done steps'
   * times, `total` the steps in all, `ceilingSeconds` the job's timeout.
   * Nothing before {@link MIN_STEPS} steps are done, nor once every step
   * is: there is nothing left to range.
   */
  public static of(input: {
    startedAt: string;
    now: number;
    stepTimes: string[];
    total: number;
    ceilingSeconds?: number;
    allowanceMinutes?: number;
  }): AgentJobPaceValue | undefined {
    const start = Date.parse(input.startedAt);
    if (!Number.isFinite(start)) return undefined;
    const times = input.stepTimes
      .map((at) => Date.parse(at))
      .filter((at) => Number.isFinite(at))
      .sort((a, b) => a - b);
    const done = times.length;
    const left = input.total - done;
    if (done < AgentJobPace.MIN_STEPS || left <= 0) return undefined;
    const minutes = (ms: number) => Math.max(0, ms) / 60_000;
    const elapsed = minutes(input.now - start);
    const last = minutes((times.at(-1) ?? start) - start);
    const low = (left * last) / done;
    const high = Math.max(low, (left * elapsed) / done);
    const allowance = input.allowanceMinutes ?? AgentJobPace.ALLOWANCE_MINUTES;
    const warning =
      input.ceilingSeconds !== undefined &&
      elapsed + low + allowance > input.ceilingSeconds / 60;
    return {
      left,
      low: Math.round(low),
      high: Math.round(high),
      warning,
    };
  }
}
