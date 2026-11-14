import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import type { Quest } from "../entities/quests.ts";

/**
 * How long a quest spent on hold (#Q2994): a hold is waiting on something
 * outside the quest, so it is not working time and stays out of cycle time.
 *
 * `heldAt` only names the hold in force, so the past comes from the `held` and
 * `unheld` events of `history`.
 */
export class QuestHoldTime {
  protected readonly dt = $inject(DateTimeProvider);

  /**
   * Milliseconds on hold between `from` and `until`. A hold still open at the
   * end of the history runs to `until`, and a hold overlapping either bound
   * counts only for the overlap.
   */
  within(
    history: Pick<Quest["history"][number], "at" | "action">[],
    from: number,
    until: number,
  ): number {
    const events = history
      .filter((it) => it.action === "held" || it.action === "unheld")
      .map((it) => ({ action: it.action, at: this.dt.of(it.at).valueOf() }))
      .sort((a, b) => a.at - b.at);

    let total = 0;
    let openedAt: number | undefined;
    for (const event of events) {
      if (event.action === "held") {
        openedAt ??= event.at;
        continue;
      }
      if (openedAt !== undefined) {
        total += this.overlap(openedAt, event.at, from, until);
        openedAt = undefined;
      }
    }
    if (openedAt !== undefined) {
      total += this.overlap(openedAt, until, from, until);
    }
    return total;
  }

  protected overlap(
    start: number,
    end: number,
    from: number,
    until: number,
  ): number {
    return Math.max(0, Math.min(end, until) - Math.max(start, from));
  }
}
