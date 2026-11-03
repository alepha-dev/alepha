import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import type { Quest } from "../entities/quests.ts";

export type QuestFlowState = "todo" | "inProgress" | "onHold" | "done";

export type QuestFlowRow = Pick<
  Quest,
  "createdAt" | "acceptedAt" | "completedAt" | "heldAt" | "shelvedAt"
> & {
  history?: Pick<Quest["history"][number], "at" | "action" | "column">[];
};

/**
 * A quest's state on any past day, rebuilt from its timestamps and `history`
 * (#Q2998). The arithmetic only: `QuestFlowService` reads the rows.
 *
 * There is no status column, so "what was this quest on the 3rd" is the same
 * derivation as `QuestResourceMapper.questStatus`, asked of a point in time.
 *
 * Known gaps, inherent to the data, which is why `quest_flow_daily` exists:
 *
 * - **A reopened quest lost its first completion.** `completedAt` holds the
 *   last one, so it reads as open between the two. Quest reopen was deleted in
 *   #E48, so only rows older than that can do this.
 * - **A soft-deleted quest is gone**, from every past day it existed on.
 * - **A hold or shelve before `history` recorded them** has no opening event;
 *   the current `heldAt` / `shelvedAt` still counts.
 * - **Epic and release moves** only exist as display strings in
 *   `history.changes`, so membership on a past day is not rebuilt here.
 * - **Priority, area and tags on a past day are today's**: a filter reads the
 *   quest as it is now.
 */
export class QuestFlowHistory {
  protected readonly dt = $inject(DateTimeProvider);

  /**
   * The last instant of a UTC day: what a state "on" that day means.
   */
  endOf(day: string): number {
    return Date.parse(day) + 86_399_999;
  }

  /**
   * The quest's state at `at`, or nothing when it was not on the board: not
   * created yet, or shelved, which leaves every count.
   */
  stateAt(quest: QuestFlowRow, at: number): QuestFlowState | undefined {
    if (this.dt.of(quest.createdAt).valueOf() > at) {
      return undefined;
    }
    if (quest.completedAt && this.dt.of(quest.completedAt).valueOf() <= at) {
      return "done";
    }
    if (this.within(quest, "shelved", "unshelved", quest.shelvedAt, at)) {
      return undefined;
    }
    if (this.within(quest, "held", "unheld", quest.heldAt, at)) {
      return "onHold";
    }
    if (this.within(quest, "assigned", "unassigned", quest.acceptedAt, at)) {
      return "inProgress";
    }
    return "todo";
  }

  /**
   * Milliseconds spent per board column, from `moved` events: each column runs
   * until the next move, the last one until `until`.
   */
  columnTimes(
    history: NonNullable<QuestFlowRow["history"]>,
    until: number,
  ): Map<string, number> {
    const moves = history
      .filter((it) => it.action === "moved" && it.column)
      .map((it) => ({
        column: it.column as string,
        at: this.dt.of(it.at).valueOf(),
      }))
      .sort((a, b) => a.at - b.at);
    const times = new Map<string, number>();
    moves.forEach((move, index) => {
      const end = moves[index + 1]?.at ?? until;
      times.set(
        move.column,
        (times.get(move.column) ?? 0) + Math.max(end - move.at, 0),
      );
    });
    return times;
  }

  /**
   * Whether `at` falls in one of the intervals `open` and `close` events draw,
   * or after `current`, the column naming the interval in force.
   */
  protected within(
    quest: QuestFlowRow,
    open: string,
    close: string,
    current: string | undefined,
    at: number,
  ): boolean {
    if (current && this.dt.of(current).valueOf() <= at) {
      return true;
    }
    let inside = false;
    const events = (quest.history ?? [])
      .filter((it) => it.action === open || it.action === close)
      .map((it) => ({ action: it.action, at: this.dt.of(it.at).valueOf() }))
      .sort((a, b) => a.at - b.at);
    for (const event of events) {
      if (event.at > at) {
        break;
      }
      inside = event.action === open;
    }
    return inside;
  }
}
