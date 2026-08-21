import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { feedback } from "../entities/feedback.ts";
import { questComments } from "../entities/questComments.ts";
import { quests } from "../entities/quests.ts";
import { relations } from "../relations.ts";
import type { ProjectActivityEvent } from "../schemas/projectActivitySchema.ts";

/**
 * Everything that moved in a project since a timestamp, in one pass.
 *
 * Why this exists: the only way for an agent to notice that the owner said
 * something was to poll `quest_get` per quest. On 2026-08-21 one listed a
 * project, worked for ten minutes, and posted on a quest four minutes after
 * the owner had, without seeing it.
 *
 * **There is no event table, and this deliberately does not create one.**
 * The data is spread over per-row stamps: `quests.updatedAt` and its
 * `history[]`, `quest_comments.createdAt`, `feedback.createdAt`, and
 * `folio_revisions.at`. At Lore's scale a union of indexed range scans is
 * the right shape; an event table is a denormalization to reach for only if
 * this gets slow.
 */
export class ProjectActivityService {
  protected readonly quests = $repository(quests);
  protected readonly comments = $repository(questComments);
  protected readonly feedback = $repository(feedback);
  protected readonly revisions = $repository(relations, "folioRevisions");
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * How far back a caller may reach. A first call cannot ask for the whole
   * project's history: the point of this tool is the diff since last time,
   * and `folio_list` / `quest_list` are the tools for a full survey.
   */
  protected readonly maxWindowDays = 30;

  /**
   * The quest history actions that map onto a kind of their own.
   * Everything else (`objective_completed`, `objective_waived`,
   * `reminder_sent`, `unshelved`, `updated`) is a `quest.updated`, with the
   * summary carrying what actually happened.
   */
  protected readonly historyKinds: Record<
    string,
    ProjectActivityEvent["kind"]
  > = {
    assigned: "quest.accepted",
    unassigned: "quest.unassigned",
    shelved: "quest.shelved",
  };

  protected readonly historySummaries: Record<string, string> = {
    assigned: "accepted",
    unassigned: "unassigned",
    shelved: "shelved",
    unshelved: "put back in play",
    objective_completed: "ticked an objective on",
    objective_waived: "waived an objective on",
    reminder_sent: "was reminded about",
    updated: "updated",
  };

  /**
   * Collect events strictly after `since`, oldest first.
   *
   * Strictly after, so a caller passing back the `until` of its previous
   * call never sees the same event twice. The cost is that two events
   * sharing an exact millisecond with `until` can be missed; that is the
   * standard trade for a timestamp cursor and it is stated in the tool
   * description.
   */
  async collect(query: {
    projectId: number;
    since: string;
    limit: number;
    excludeUserId?: string;
  }): Promise<{
    events: ProjectActivityEvent[];
    truncated: boolean;
    since: string;
    sinceClamped: boolean;
  }> {
    const floor = new Date(
      this.dateTime.nowMillis() - this.maxWindowDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const sinceClamped = Date.parse(query.since) < Date.parse(floor);
    const since = sinceClamped ? floor : query.since;

    const collected = [
      ...(await this.questEvents(query.projectId, since)),
      ...(await this.commentEvents(query.projectId, since)),
      ...(await this.feedbackEvents(query.projectId, since)),
      ...(await this.folioEvents(query.projectId, since)),
    ];

    const kept = query.excludeUserId
      ? collected.filter((event) => event.actorId !== query.excludeUserId)
      : collected;

    // `at` then kind, so a quest accepted and completed in the same
    // millisecond still reads in a stable order across calls.
    kept.sort(
      (a, b) =>
        Date.parse(a.at) - Date.parse(b.at) || a.kind.localeCompare(b.kind),
    );

    return {
      events: kept.slice(0, query.limit),
      truncated: kept.length > query.limit,
      since,
      sinceClamped,
    };
  }

  /**
   * Quest lifecycle, derived from `history[]` where it exists and from the
   * timestamp columns where it does not.
   *
   * `completed` and `created` are the two that write no history row, so
   * they are read off `completedAt` / `createdAt`. Everything else that
   * happened would double up if it were derived both ways.
   */
  protected async questEvents(
    projectId: number,
    since: string,
  ): Promise<ProjectActivityEvent[]> {
    const rows = await this.quests.findMany({
      where: {
        projectId: { eq: projectId },
        updatedAt: { gt: since },
        deletedAt: { isNull: true },
      },
      // Deliberately not gated on the epic's status: MCP is not gated
      // (design §5.3), and a quest under a planned epic that moved is
      // exactly as interesting as any other.
    });

    const events: ProjectActivityEvent[] = [];
    for (const quest of rows) {
      const ref = { shortId: quest.shortId, title: quest.title };
      const before = events.length;

      if (Date.parse(quest.createdAt) > Date.parse(since)) {
        events.push({
          at: quest.createdAt,
          kind: "quest.created",
          actorId: quest.createdBy,
          quest: ref,
          summary: `filed quest #${quest.shortId}`,
        });
      }

      for (const entry of quest.history) {
        if (Date.parse(entry.at) <= Date.parse(since)) continue;
        events.push({
          at: entry.at,
          kind: this.historyKinds[entry.action] ?? "quest.updated",
          actorId: entry.by,
          quest: ref,
          summary: `${this.historySummaries[entry.action] ?? "updated"} quest #${quest.shortId}`,
        });
      }

      if (
        quest.completedAt &&
        Date.parse(quest.completedAt) > Date.parse(since)
      ) {
        events.push({
          at: quest.completedAt,
          kind: "quest.completed",
          actorId: quest.completedBy,
          quest: ref,
          summary: `completed quest #${quest.shortId}`,
        });
      }

      // `updatedAt` moved with nothing else to show for it: a plain field
      // edit (title, description, tags, …), which writes no history row on
      // a completed quest and is otherwise covered above.
      if (events.length === before) {
        events.push({
          at: quest.updatedAt,
          kind: "quest.updated",
          quest: ref,
          summary: `changed quest #${quest.shortId}`,
        });
      }
    }
    return events;
  }

  /**
   * Comments, which is the signal the missed reply was.
   */
  protected async commentEvents(
    projectId: number,
    since: string,
  ): Promise<ProjectActivityEvent[]> {
    const rows = await this.comments.findMany({
      where: { createdAt: { gt: since } },
    });
    if (rows.length === 0) return [];

    // The comments table carries no `projectId`, so the quests they hang
    // off are what scopes them. One lookup for the page, not one per row.
    const questRows = await this.quests.findMany({
      where: {
        id: { inArray: [...new Set(rows.map((row) => row.questId))] },
        projectId: { eq: projectId },
      },
      columns: ["id", "shortId", "title"],
    });
    const byId = new Map(questRows.map((quest) => [quest.id, quest]));

    return rows.flatMap((row) => {
      const quest = byId.get(row.questId);
      if (!quest) return [];
      return [
        {
          at: row.createdAt,
          kind: "quest.commented" as const,
          actorId: row.authorId,
          actorKind:
            row.source?.kind === "mcp" ? ("agent" as const) : undefined,
          quest: { shortId: quest.shortId, title: quest.title },
          summary: `commented on quest #${quest.shortId}`,
        },
      ];
    });
  }

  /**
   * Feedback arrivals.
   *
   * Only arrivals: the `feedback` table has no update stamp at all, so a
   * triage decision leaves nothing an activity feed can find. Adding one is
   * a hand-written migration (`ADD COLUMN … NOT NULL` is green on every
   * empty database and refused on the populated one), so it is out of scope
   * here rather than half-done.
   */
  protected async feedbackEvents(
    projectId: number,
    since: string,
  ): Promise<ProjectActivityEvent[]> {
    const rows = await this.feedback.findMany({
      where: {
        projectId: { eq: projectId },
        createdAt: { gt: since },
        deletedAt: { isNull: true },
      },
    });

    return rows.map((row) => ({
      at: row.createdAt,
      kind: "feedback.created" as const,
      actorId: row.reporterUserId,
      feedback: { shortId: row.shortId, title: row.title },
      summary: `reported feedback #${row.shortId}`,
    }));
  }

  /**
   * Folio writes, read off the revision log rather than `folios.updatedAt`
   * so the event carries an actor.
   */
  protected async folioEvents(
    projectId: number,
    since: string,
  ): Promise<ProjectActivityEvent[]> {
    const rows = await this.revisions.findMany({
      where: { at: { gt: since }, folio: { projectId: { eq: projectId } } },
      include: { folio: { select: ["shortId", "title"] } },
    });

    return rows.map((row) => ({
      at: row.at,
      kind: "folio.updated" as const,
      actorId: row.byUserId,
      folio: {
        shortId: row.folio?.shortId ?? 0,
        title: row.folio?.title ?? row.titleSnapshot,
      },
      summary: `${row.action === "create" ? "wrote" : row.action === "rename" ? "renamed" : "edited"} folio #${row.folio?.shortId ?? 0}`,
    }));
  }
}
