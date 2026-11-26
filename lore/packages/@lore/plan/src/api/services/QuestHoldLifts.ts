import { CommentService, HourlyChecks } from "@lore/core/api";
import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import {
  $repository,
  SqlExpressionProvider,
  type SqlLike,
  sql,
} from "alepha/orm";

import { type Quest, quests } from "../entities/quests.ts";
import { PlanCommentSubjects } from "./PlanCommentSubjects.ts";

/**
 * Dated holds lift on their own (#Q4408). A check of the hourly job, on the
 * model of `QuestReminders`:
 *
 * - **One indexed query** for every hold whose `heldUntil` has passed, across
 *   all projects (`quests_holds_due_idx`), at most {@link LIMIT} per tick,
 *   the rest at the next.
 * - The hold is lifted as `unholdQuest` lifts it, and the quest goes back to
 *   **To do whatever it was before**, the owner's call: a quest parked for
 *   two weeks comes back to the backlog, not to whoever had it. Its timer
 *   stops, its reminder goes, its comments, commits and objectives stay.
 * - **Once.** The write is conditioned on the `heldUntil` the tick read, so
 *   a second tick, or a person who lifted the hold in between, finds no row
 *   and posts nothing.
 * - **No notification.** One line in the discussion, written as whoever held
 *   it and marked as a machine's, says the hold ended; nobody is told
 *   otherwise. A quest whose holder's account is gone gets no line.
 */
export class QuestHoldLifts {
  public static readonly LIMIT = 100;

  /**
   * The client the discussion line names.
   */
  public static readonly CLIENT = "lore-holds";

  protected readonly log = $logger();
  protected readonly checks = $inject(HourlyChecks);
  protected readonly sqlx = $inject(SqlExpressionProvider);
  protected readonly quests = $repository(quests);
  protected readonly comments = $inject(CommentService);

  constructor() {
    this.checks.register({
      name: "quests.hold-lifts",
      run: async (now) => {
        await this.run(now);
      },
    });
  }

  /**
   * The holds due at `now`, oldest first: one query.
   */
  public async due(now: string): Promise<Quest[]> {
    return this.quests.findMany({
      where: {
        heldUntil: { lte: now },
        heldAt: { isNotNull: true },
        completedAt: { isNull: true },
      },
      orderBy: [{ column: "heldUntil", direction: "asc" }],
      limit: QuestHoldLifts.LIMIT,
    });
  }

  /**
   * Lifts every hold due at `now`. Answers the quests' numbers.
   */
  public async run(now: string): Promise<number[]> {
    const lifted: number[] = [];
    for (const quest of await this.due(now)) {
      try {
        if (await this.lift(quest, now)) lifted.push(quest.shortId);
      } catch (error) {
        this.log.warn("could not lift a dated hold", {
          questId: quest.id,
          error,
        });
      }
    }
    return lifted;
  }

  protected async lift(quest: Quest, now: string): Promise<boolean> {
    const by = quest.heldBy ?? quest.acceptedBy;
    // Appended in SQL, not written back from the read: a history line added
    // between the read and this write survives.
    let history: SqlLike = sql`history`;
    if (by) {
      history = this.sqlx.jsonArrayAppend(history, {
        at: now,
        by,
        action: "unheld",
      });
      if (quest.acceptedAt) {
        history = this.sqlx.jsonArrayAppend(history, {
          at: now,
          by,
          action: "unassigned",
        });
      }
    }
    const running = (quest.timerSessions ?? []).some((it) => !it.stoppedAt);
    const ids = await this.quests.updateMany(
      {
        id: { eq: quest.id },
        heldAt: { isNotNull: true },
        heldUntil: { eq: quest.heldUntil! },
      },
      {
        heldAt: null,
        heldBy: null,
        heldUntil: null,
        acceptedAt: null,
        acceptedBy: null,
        agentJobId: null,
        agentName: null,
        kanbanColumn: null,
        reminderInterval: null,
        reminderNextAt: null,
        // Only a running timer is stopped; otherwise the sessions are left
        // as they are.
        ...(running
          ? {
              timerSessions: quest.timerSessions.map((session) =>
                session.stoppedAt ? session : { ...session, stoppedAt: now },
              ),
            }
          : {}),
        history,
      } as never,
    );
    // Another tick lifted it first, or somebody did by hand.
    if (!ids.length) return false;
    if (quest.heldBy) {
      await this.comments.add({
        type: PlanCommentSubjects.QUEST,
        projectId: quest.projectId,
        subjectId: quest.id,
        authorId: quest.heldBy,
        body: this.bodyOf(),
        source: { kind: "mcp", client: QuestHoldLifts.CLIENT },
      });
    }
    return true;
  }

  /**
   * The line in the discussion. No date: the day was picked in the reader's
   * time zone and stored in UTC, so a date printed here could read a day
   * early. The hold's own history entry carries the time.
   */
  protected bodyOf(): string {
    return "The dated hold has ended: the quest is back in To do.";
  }
}
