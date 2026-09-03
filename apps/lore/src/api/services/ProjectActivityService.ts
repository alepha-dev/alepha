import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { epics } from "../entities/epics.ts";
import { feedback } from "../entities/feedback.ts";
import { quests } from "../entities/quests.ts";
import { releases } from "../entities/releases.ts";
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
 * `history[]`, `quest_comments.createdAt`, `feedback.createdAt`,
 * `folio_revisions.at`, `epics.updatedAt` and `releases.updatedAt`. At
 * Lore's scale a union of indexed range scans is the right shape; an event
 * table is a denormalization to reach for only if this gets slow.
 *
 * ⚠️ **Every read here is projected, and that is load-bearing rather than
 * tidy.** `folio_revisions.contentSnapshot` is a full copy of the folio body
 * per save - ~8.8 KB a row and roughly 30% of production's whole database -
 * and `quests.description` averages 1.27 KB. Unprojected, a week's window
 * moved hundreds of kilobytes out of D1 to render a few dozen one-line
 * events. Adding a column to one of these `columns` lists is a bandwidth
 * decision, not a formality.
 *
 * Each read is also backed by an index that leads on the column its window
 * filters (see the entities). Before this quest, `quest_comments` had no
 * index at all and `folio_revisions` had one leading on `folioId`, so two of
 * the four scans were full table reads.
 */
export class ProjectActivityService {
  protected readonly quests = $repository(quests);
  protected readonly comments = $repository(relations, "questComments");
  protected readonly feedback = $repository(feedback);
  protected readonly revisions = $repository(relations, "folioRevisions");
  protected readonly epics = $repository(epics);
  protected readonly releases = $repository(releases);
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
      ...(await this.epicEvents(query.projectId, since)),
      ...(await this.releaseEvents(query.projectId, since)),
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
      // `description` is the one this leaves behind, and it is the whole
      // point: it averages 1.27 KB a row on production and nothing below
      // reads it. `history` has to stay - it is where most of the events
      // come from.
      columns: [
        "shortId",
        "title",
        "createdAt",
        "updatedAt",
        "completedAt",
        "completedBy",
        "createdBy",
        "history",
      ],
      // Deliberately not gated on the epic's status, and this now holds for
      // a human page as well as for MCP. The backlog gate keeps planned
      // epics out of the quest list, the board and the Reports
      // denominators - surfaces that answer "what is there to do". This one
      // answers "what happened", where a quest moving under a planned epic
      // is exactly as true as any other. The feed is member-gated, and the
      // sidebar already surfaces planned epics through
      // `currentEpicCountAtom` for the same reason.
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
    // The comments table carries no `projectId`, so the quest a comment
    // hangs off is what scopes it - and that scoping is a join, not a filter
    // applied afterwards. This used to read every comment in the instance
    // since `since`, then look their quests up and drop the ones that
    // belonged elsewhere: correct output, at a cost that grew with every
    // other project on the deployment rather than with this one. Same shape
    // as `folioRevisions` below, which has always joined.
    const rows = await this.comments.findMany({
      where: {
        createdAt: { gt: since },
        quest: { projectId: { eq: projectId } },
      },
      // `body` is rich markdown and is never read here: the feed says that
      // a comment happened, and `quest_get` is what serves the text.
      columns: ["createdAt", "authorId", "source"],
      include: { quest: { select: ["shortId", "title"] } },
    });

    return rows.flatMap((row) => {
      const quest = row.quest;
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
      columns: ["shortId", "title", "createdAt", "reporterUserId"],
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
      // ⚠️ The projection that matters most in this file. Without it every
      // revision in the window arrives carrying `contentSnapshot`, a whole
      // copy of the folio body, to produce one line of text.
      columns: ["at", "byUserId", "action", "titleSnapshot"],
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

  /**
   * Epics, split into arrival and everything after it.
   *
   * `epics` writes no history rows and carries no `createdBy`, so this is
   * the whole of what the table can say: an epic appeared, or an epic
   * changed. Which field changed - a status move, a retitle, a release
   * attachment - is not recoverable, so the summary does not claim to know.
   * That is a real limit of deriving events from row stamps rather than an
   * omission, and it is why `epic.updated` reads as vaguely as it does.
   *
   * A row can yield both, and must: see the comment on the second push.
   */
  protected async epicEvents(
    projectId: number,
    since: string,
  ): Promise<ProjectActivityEvent[]> {
    const rows = await this.epics.findMany({
      where: {
        projectId: { eq: projectId },
        updatedAt: { gt: since },
        deletedAt: { isNull: true },
      },
      columns: ["number", "title", "createdAt", "updatedAt"],
    });

    const events: ProjectActivityEvent[] = [];
    for (const row of rows) {
      const ref = { number: row.number, title: row.title };

      if (Date.parse(row.createdAt) > Date.parse(since)) {
        events.push({
          at: row.createdAt,
          kind: "epic.created",
          epic: ref,
          summary: `opened epic #${row.number}`,
        });
      }

      // Both, when both happened. Collapsing to one event would hide the
      // more recent fact behind the older one: an epic created five days
      // ago and activated this morning would report only its creation, on
      // a page whose whole job is to say what just moved.
      //
      // `>` against `createdAt` rather than `>=`, because a create stamps
      // both columns to the same instant and that is one event, not two.
      if (Date.parse(row.updatedAt) > Date.parse(row.createdAt)) {
        events.push({
          at: row.updatedAt,
          kind: "epic.updated",
          epic: ref,
          summary: `changed epic #${row.number}`,
        });
      }
    }
    return events;
  }

  /**
   * Releases: created, and published.
   *
   * Publishing is the one release transition worth a line, and it is
   * derivable because it has its own stamp (`releasedAt`, which is also
   * what "released" MEANS here - there is no status column). A release
   * created and published inside the same window yields both events, in
   * that order, which is the true story of that window.
   *
   * Reopening writes no stamp of its own - it clears `releasedAt` - so it
   * is invisible here, the same way a feedback triage decision is.
   */
  protected async releaseEvents(
    projectId: number,
    since: string,
  ): Promise<ProjectActivityEvent[]> {
    const rows = await this.releases.findMany({
      where: {
        projectId: { eq: projectId },
        updatedAt: { gt: since },
      },
      columns: ["tag", "title", "createdAt", "updatedAt", "releasedAt"],
    });

    const events: ProjectActivityEvent[] = [];
    for (const row of rows) {
      const ref = { tag: row.tag, title: row.title };
      const named = row.tag ?? row.title;

      if (Date.parse(row.createdAt) > Date.parse(since)) {
        events.push({
          at: row.createdAt,
          kind: "release.created",
          release: ref,
          summary: `opened release ${named}`,
        });
      }

      if (row.releasedAt && Date.parse(row.releasedAt) > Date.parse(since)) {
        events.push({
          at: row.releasedAt,
          kind: "release.published",
          release: ref,
          summary: `published release ${named}`,
        });
      }
    }
    return events;
  }
}
