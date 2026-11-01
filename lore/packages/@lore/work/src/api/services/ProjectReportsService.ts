import { ReportStatistics } from "@lore/core/api";
import { projects, type ReportsQuery } from "@lore/core/schemas";
import {
  reportsOverviewSchema,
  reportsPeriodFiguresSchema,
  reportsQuestsSchema,
} from "@lore/core/schemas";
import { $inject, type Infer, z } from "alepha";
import { organizationMembers } from "alepha/api/organizations";
import { users } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import {
  $repository,
  DatabaseProvider,
  type PgQueryWhere,
  SqlExpressionProvider,
  sql,
} from "alepha/orm";

import { questComments } from "../entities/questComments.ts";
import { type Quest, quests } from "../entities/quests.ts";
import { byPriorityDesc } from "../schemas/questPriority.ts";
import { DashboardFlowSeries } from "./DashboardFlowSeries.ts";
import { EpicVisibilityService } from "./EpicVisibilityService.ts";
import { QuestHoldTime } from "./QuestHoldTime.ts";
import { QuestTagTallyService } from "./QuestTagTallyService.ts";

/**
 * The Reports queries, for every reader of them: the Reports tabs, and the
 * dashboard's flow tiles (#E77, #Q2653), which wrap these methods rather than
 * copying their SQL, so the board and Reports cannot disagree.
 *
 * Moved verbatim out of `ProjectReportsController`, which now only gates and
 * delegates. Callers have already proved `stats:read` on the project.
 */
export class ProjectReportsService {
  protected readonly quests = $repository(quests);
  protected readonly comments = $repository(questComments);
  protected readonly members = $repository(organizationMembers);
  protected readonly projects = $repository(projects);
  protected readonly users = $repository(users);
  protected readonly database = $inject(DatabaseProvider);
  protected readonly sqlx = $inject(SqlExpressionProvider);
  protected readonly epicVisibility = $inject(EpicVisibilityService);
  /**
   * The fold that turns `quests.tags` into a per-tag tally.
   *
   * ⚠️ On a service since #Q2108, because the dashboard's tag card is the
   * second reader of it and two copies of a tally is the silent disagreement
   * a shared service exists to prevent. The raw-SQL row read stays here: it
   * rides an aggregate query this handler already runs.
   */
  protected readonly tagTally = $inject(QuestTagTallyService);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly series = $inject(DashboardFlowSeries);
  protected readonly stats = $inject(ReportStatistics);
  protected readonly holdTime = $inject(QuestHoldTime);

  /**
   * The query a dashboard tile reads a report with (#Q2995): the project's
   * whole history at the default thresholds, so a tile keeps its fixed range
   * and a report asked for the same query cannot disagree with it.
   */
  readonly fixedQuery: ReportsQuery = {};

  /**
   * The "this quest is in scope" where-object every report filters on.
   *
   * Soft-deleted quests are the repository's own filter. Shelved quests were
   * deliberately set aside as out of scope, so they leave both the numerator
   * and the denominator of every chart: a release can hit 100% with shelved
   * quests left over. Completed-based metrics are unaffected by construction,
   * since only a "todo" quest can be shelved.
   *
   * An **open** quest inside a `draft` epic is specified and not released yet,
   * so it leaves both sides the way a shelved one does.
   *
   * ⚠️ **Completed quests are exempt from that gate, and the exemption is the
   * point.** A completed quest can sit in a `draft` epic and keeps its `epicId`
   * there. Gating those would retroactively erase real work from member
   * credit, the burn-up and the weekly contribution series. Completed work is
   * history; the gate answers "is this open to work on", which is not a
   * question a finished quest has.
   *
   * Two traps: the `isNull` branch keeps a quest with no epic (`epic_id NOT IN
   * (…)` is NULL for it), and an empty draft set adds no clause at all.
   * `QuestTagTallyService.rowsFor` spells the same rule for several projects.
   *
   * The Work filters of `query` narrow it. ⚠️ `memberId` goes through `and`,
   * since the gate owns the top-level `or`.
   */
  protected questScope(
    projectId: number,
    draftEpicIds: number[],
    query: ReportsQuery = {},
  ): PgQueryWhere<typeof quests.schema> {
    const where: PgQueryWhere<typeof quests.schema> = {
      projectId: { eq: projectId },
      shelvedAt: { isNull: true },
    };
    if (query.area !== undefined) where.area = { eq: query.area };
    if (query.priority !== undefined) where.priority = { eq: query.priority };
    if (query.epicId !== undefined) where.epicId = { eq: query.epicId };
    if (query.releaseId !== undefined) {
      where.releaseId = { eq: query.releaseId };
    }
    if (query.tag !== undefined) {
      Object.assign(where, {
        tags: { like: `%"${query.tag.toLowerCase()}"%` },
      });
    }
    if (query.memberId !== undefined) {
      where.and = [
        {
          or: [
            { acceptedBy: { eq: query.memberId } },
            { completedBy: { eq: query.memberId } },
          ],
        },
      ];
    }
    if (draftEpicIds.length > 0) {
      where.or = [
        { completedAt: { isNotNull: true } },
        { epicId: { isNull: true } },
        { epicId: { notInArray: draftEpicIds } },
      ];
    }
    return where;
  }

  /**
   * {@link questScope} for a reader outside this service, with the project's
   * draft epics looked up.
   */
  async scopeOf(
    projectId: number,
    query: ReportsQuery,
  ): Promise<PgQueryWhere<typeof quests.schema>> {
    return this.questScope(
      projectId,
      await this.epicVisibility.draftEpicIds(projectId),
      query,
    );
  }

  /**
   * A completion inside the window: the bound of every "done in the period"
   * figure. The where-object encodes the timestamps for the column.
   */
  protected completedWithin(window: ReportWindow) {
    return {
      isNotNull: true as const,
      ...(window.from ? { gte: window.from } : {}),
      ...(window.to ? { lte: window.to } : {}),
    };
  }

  /**
   * The same test for a timestamp already read.
   */
  protected inWindow(at: string, window: ReportWindow): boolean {
    const time = this.dt.of(at).valueOf();
    return (
      (!window.from || time >= this.dt.of(window.from).valueOf()) &&
      (!window.to || time <= this.dt.of(window.to).valueOf())
    );
  }

  /**
   * The period of the same length right before `query`'s, when the query asks
   * for it and the period has a start to measure from.
   */
  protected previousWindow(query: ReportsQuery): ReportWindow | undefined {
    if (!query.compare || !query.from) {
      return undefined;
    }
    const from = this.dt.of(query.from).valueOf();
    const to = query.to ? this.dt.of(query.to).valueOf() : this.dt.nowMillis();
    return {
      from: new Date(from - (to - from)).toISOString(),
      to: new Date(from - 1).toISOString(),
    };
  }

  /**
   * Quests created per day over the project's lifetime, in scope.
   *
   * The burn-up's left half, and the dashboard's burn-up tile (#Q2653) reads
   * it from here rather than restating the query. The period does not apply:
   * a cumulative series starts from everything before it.
   */
  async createdByDay(
    projectId: number,
    query: ReportsQuery,
  ): Promise<Array<{ date: string; count: number }>> {
    return this.createdDaily(
      this.questScope(
        projectId,
        await this.epicVisibility.draftEpicIds(projectId),
        query,
      ),
    );
  }

  protected async createdDaily(
    where: PgQueryWhere<typeof quests.schema>,
  ): Promise<Array<{ date: string; count: number }>> {
    const rows = await this.quests.aggregate({
      select: {
        date: { expr: this.sqlx.dateDay(this.quests.table.createdAt) },
        quests: { count: { column: "id" } },
      },
      where,
      groupBy: ["date"],
    });
    return rows.map((row) => ({
      date: String(row.date),
      count: row.quests.count,
    }));
  }

  /**
   * Quests completed per day over the project's lifetime, in scope: the
   * burn-up's right half, and every dashboard flow tile's source (#Q2653).
   */
  async completedByDay(
    projectId: number,
    query: ReportsQuery,
  ): Promise<Array<{ date: string; count: number }>> {
    return this.completedDaily(
      this.questScope(
        projectId,
        await this.epicVisibility.draftEpicIds(projectId),
        query,
      ),
    );
  }

  protected async completedDaily(
    where: PgQueryWhere<typeof quests.schema>,
  ): Promise<Array<{ date: string; count: number }>> {
    const rows = await this.quests.aggregate({
      select: {
        date: { expr: this.sqlx.dateDay(this.quests.table.completedAt) },
        quests: { count: { column: "id" } },
      },
      where: { ...where, completedAt: { isNotNull: true } },
      groupBy: ["date"],
    });
    return rows.map((row) => ({
      date: String(row.date),
      count: row.quests.count,
    }));
  }

  /**
   * Hours from accepted to completed per completed quest in scope, hold time
   * taken out: a quest waiting on somebody else is not being worked on.
   *
   * `history` is the heavy column of `quests`, so it is read only for the few
   * quests whose serialized history holds a `held` event.
   */
  protected async cycleSamples(
    scope: PgQueryWhere<typeof quests.schema>,
    window: ReportWindow = {},
  ): Promise<Array<{ priority: Quest["priority"]; hours: number }>> {
    const where = {
      ...scope,
      acceptedAt: { isNotNull: true },
      completedAt: this.completedWithin(window),
    };
    const [rows, heldRows] = await Promise.all([
      this.quests.findMany({
        where,
        columns: ["id", "priority", "acceptedAt", "completedAt"],
      }),
      this.quests.findMany({
        where: { ...where, history: { like: '%"held"%' } } as typeof where,
        columns: ["id", "history"],
      }),
    ]);
    const historyOf = new Map(heldRows.map((row) => [row.id, row.history]));

    return rows.map((row) => {
      const from = this.dt.of(row.acceptedAt!).valueOf();
      const until = this.dt.of(row.completedAt!).valueOf();
      const held = this.holdTime.within(
        historyOf.get(row.id) ?? [],
        from,
        until,
      );
      return {
        priority: row.priority,
        hours: Math.max(until - from - held, 0) / 3_600_000,
      };
    });
  }

  /**
   * Members who created, accepted, completed or commented on a quest of this
   * project inside the window. Every organization member is not an active one.
   *
   * Not through `questScope`: filing a quest in a draft epic is still activity.
   * ⚠️ Intersected with the member list, so someone who left is not counted.
   */
  protected async countActiveMembers(
    projectId: number,
    organizationId: string,
    window: ReportWindow,
  ): Promise<number> {
    const within = {
      ...(window.from ? { gte: window.from } : {}),
      ...(window.to ? { lte: window.to } : {}),
    };
    const [members, touched, commented] = await Promise.all([
      this.members.findMany({
        where: { organizationId: { eq: organizationId } },
        columns: ["userId"],
      }),
      this.quests.findMany({
        where: {
          projectId: { eq: projectId },
          or: [
            { createdAt: within },
            { acceptedAt: within },
            { completedAt: within },
          ],
        },
        columns: [
          "createdAt",
          "createdBy",
          "acceptedAt",
          "acceptedBy",
          "completedAt",
          "completedBy",
        ],
      }),
      this.comments.findMany({
        where: {
          createdAt: within,
          exists: this.quests.subquery({
            id: { eq: this.comments.table.questId },
            projectId: { eq: projectId },
          }),
        },
        columns: ["authorId"],
      }),
    ]);

    const active = new Set<string>();
    for (const quest of touched) {
      if (this.inWindow(quest.createdAt, window)) active.add(quest.createdBy);
      if (
        quest.acceptedBy &&
        quest.acceptedAt &&
        this.inWindow(quest.acceptedAt, window)
      ) {
        active.add(quest.acceptedBy);
      }
      if (
        quest.completedBy &&
        quest.completedAt &&
        this.inWindow(quest.completedAt, window)
      ) {
        active.add(quest.completedBy);
      }
    }
    for (const comment of commented) {
      if (comment.authorId) active.add(comment.authorId);
    }
    return members.filter((member) => active.has(member.userId)).length;
  }

  protected cycleFigures(samples: Array<{ hours: number }>) {
    const hours = samples.map((sample) => sample.hours);
    return {
      medianCycleTimeHours: this.stats.median(hours),
      p85CycleTimeHours: this.stats.percentile(hours, 85),
    };
  }

  /**
   * What one period adds up to. `activeWindow` is `window` with a start: an
   * unbounded "active member" would be everyone who ever touched a quest.
   */
  protected async periodFigures(
    projectId: number,
    organizationId: string,
    scope: PgQueryWhere<typeof quests.schema>,
    window: ReportWindow,
    activeWindow: ReportWindow,
  ): Promise<Infer<typeof reportsPeriodFiguresSchema>> {
    const [created, completed, samples, activeMembers] = await Promise.all([
      this.quests.count({
        ...scope,
        ...(window.from || window.to
          ? {
              createdAt: {
                ...(window.from ? { gte: window.from } : {}),
                ...(window.to ? { lte: window.to } : {}),
              },
            }
          : {}),
      }),
      this.quests.count({
        ...scope,
        completedAt: this.completedWithin(window),
      }),
      this.cycleSamples(scope, window),
      this.countActiveMembers(projectId, organizationId, activeWindow),
    ]);
    return { created, completed, ...this.cycleFigures(samples), activeMembers };
  }

  /**
   * The figures Flow, the Summary and the dashboard tiles share: KPI tiles, a cumulative created-vs-completed
   * burn-up chart, and counts of quests that
   * need attention (stale, not started, blocked).
   *
   * Members-only. Every date computation
   * dialect-branches (SQLite epoch-ms ints in production, Postgres timestamps
   * in tests).
   */
  async overview(
    projectId: number,
    query: ReportsQuery,
  ): Promise<Infer<typeof reportsOverviewSchema>> {
    const params = { id: projectId };
    const organizationId = (
      await this.projects.getOne({ where: { id: { eq: params.id } } })
    ).organizationId!;
    const scope = this.questScope(
      params.id,
      await this.epicVisibility.draftEpicIds(params.id),
      query,
    );
    const window: ReportWindow = { from: query.from, to: query.to };

    // Week windows bound on the app clock (`DateTimeProvider`), not the
    // database's: the where-object encodes them for the column on both
    // dialects.
    const weekAgo = this.dt.now().subtract(7, "day").toISOString();
    const twoWeeksAgo = this.dt.now().subtract(14, "day").toISOString();
    const staleSince = this.dt
      .now()
      .subtract(query.staleDays ?? 14, "day")
      .toISOString();
    // Without a period, "active" reads the last 30 days and the burn-up the
    // last 90: neither means anything over a whole history.
    const activeWindow: ReportWindow = {
      from: query.from ?? this.dt.now().subtract(30, "day").toISOString(),
      to: query.to,
    };

    // KPI aggregate: single pass over the project's live quests. `column:
    // "id"` because a conditioned COUNT skips NULLs of the column it counts,
    // and the key is never null.
    const [kpiAgg] = await this.quests.aggregate({
      select: {
        totalQuests: { count: { column: "id" } },
        completedQuests: {
          count: { column: "id", where: { completedAt: { isNotNull: true } } },
        },
        openQuests: {
          count: {
            column: "id",
            where: {
              acceptedAt: { isNotNull: true },
              completedAt: { isNull: true },
              heldAt: { isNull: true },
            },
          },
        },
        heldQuests: {
          count: {
            column: "id",
            where: {
              completedAt: { isNull: true },
              heldAt: { isNotNull: true },
            },
          },
        },
        completedThisWeek: {
          count: { column: "id", where: { completedAt: { gte: weekAgo } } },
        },
        completedLastWeek: {
          count: {
            column: "id",
            where: { completedAt: { gte: twoWeeksAgo, lt: weekAgo } },
          },
        },
      },
      where: scope,
    });

    const period = await this.periodFigures(
      params.id,
      organizationId,
      scope,
      window,
      activeWindow,
    );
    const previousWindow = this.previousWindow(query);
    const previous =
      previousWindow &&
      (await this.periodFigures(
        params.id,
        organizationId,
        scope,
        previousWindow,
        previousWindow,
      ));

    const kpis = {
      totalQuests: Number(kpiAgg?.totalQuests.count) || 0,
      completedQuests: Number(kpiAgg?.completedQuests.count) || 0,
      openQuests: Number(kpiAgg?.openQuests.count) || 0,
      heldQuests: Number(kpiAgg?.heldQuests.count) || 0,
      completedThisWeek: Number(kpiAgg?.completedThisWeek.count) || 0,
      completedLastWeek: Number(kpiAgg?.completedLastWeek.count) || 0,
      medianCycleTimeHours: period.medianCycleTimeHours,
      p85CycleTimeHours: period.p85CycleTimeHours,
      activeMembers: period.activeMembers,
    };

    // Daily created and completed counts over the project's lifetime.
    const createdByDay = await this.createdDaily(scope);
    const completedByDay = await this.completedDaily(scope);

    // A continuous calendar axis, zero-filled: a quiet week is a flat stretch
    // of the chart rather than a gap that collapses, and "90" is days, never
    // points. The totals carry everything before the window.
    const axis = query.from
      ? this.series.between(query.from, query.to ?? this.dt.nowISOString())
      : this.series.days(90);
    const created = this.series.cumulativeOver(createdByDay, axis);
    const completed = this.series.cumulativeOver(completedByDay, axis);
    const daily =
      (created.at(-1)?.value ?? 0) + (completed.at(-1)?.value ?? 0) > 0
        ? created.map((point, index) => ({
            at: point.at,
            created: point.value,
            completed: completed[index]?.value ?? 0,
          }))
        : [];
    const burnup = this.series
      .sampled(daily, query.grain ?? this.series.grainFor(axis.length))
      .map(({ at, ...point }) => ({ date: at, ...point }));

    // Attention counts. A quest is blocked while the one it depends on is
    // still open: `subquery` correlates through the outer `depends_on`.
    const [attentionAgg] = await this.quests.aggregate({
      select: {
        staleQuests: {
          count: {
            column: "id",
            where: {
              acceptedAt: { isNotNull: true, lt: staleSince },
              completedAt: { isNull: true },
              heldAt: { isNull: true },
            },
          },
        },
        notStartedQuests: {
          count: {
            column: "id",
            where: {
              acceptedAt: { isNull: true },
              completedAt: { isNull: true },
              heldAt: { isNull: true },
            },
          },
        },
        blockedQuests: {
          count: {
            column: "id",
            where: {
              completedAt: { isNull: true },
              dependsOn: { isNotNull: true },
              exists: this.quests.subquery({
                id: { eq: this.quests.table.dependsOn },
                completedAt: { isNull: true },
              }),
            },
          },
        },
      },
      where: scope,
    });

    const attention = {
      staleQuests: Number(attentionAgg?.staleQuests.count) || 0,
      notStartedQuests: Number(attentionAgg?.notStartedQuests.count) || 0,
      blockedQuests: Number(attentionAgg?.blockedQuests.count) || 0,
    };

    return {
      kpis,
      period,
      ...(previous ? { previous } : {}),
      burnup,
      attention,
    };
  }

  /**
   * The quest breakdowns the dashboard tiles read: a lifecycle funnel (to do → in progress → completed),
   * completed-vs-remaining breakdowns by area and by priority, median cycle
   * time per priority, and an actionable list of the oldest still-open quests.
   *
   * Same access model as `getReportsOverview`: members-only. Date
   * computations dialect-branch (SQLite epoch-ms integers on D1, Postgres
   * timestamps on node).
   */
  async questsReport(
    projectId: number,
    query: ReportsQuery,
  ): Promise<Infer<typeof reportsQuestsSchema>> {
    const params = { id: projectId };
    const draftEpicIds = await this.epicVisibility.draftEpicIds(params.id);
    const scope = this.questScope(params.id, draftEpicIds, query);
    const window: ReportWindow = { from: query.from, to: query.to };
    const top = query.top ?? 8;

    // The two halves every breakdown splits on. `column: "id"` because a
    // conditioned COUNT skips NULLs of the column it counts, and the key is
    // never null.
    const completedCount = {
      count: {
        column: "id",
        where: { completedAt: this.completedWithin(window) },
      },
    } as const;
    const remainingCount = {
      count: { column: "id", where: { completedAt: { isNull: true } } },
    } as const;

    // Lifecycle funnel — single pass over the project's live quests.
    const [funnelAgg] = await this.quests.aggregate({
      select: {
        todo: {
          count: {
            column: "id",
            where: {
              acceptedAt: { isNull: true },
              completedAt: { isNull: true },
              heldAt: { isNull: true },
            },
          },
        },
        inProgress: {
          count: {
            column: "id",
            where: {
              acceptedAt: { isNotNull: true },
              completedAt: { isNull: true },
              heldAt: { isNull: true },
            },
          },
        },
        held: {
          count: {
            column: "id",
            where: {
              completedAt: { isNull: true },
              heldAt: { isNotNull: true },
            },
          },
        },
        completed: completedCount,
      },
      where: scope,
    });

    const funnel = {
      todo: funnelAgg?.todo.count ?? 0,
      inProgress: funnelAgg?.inProgress.count ?? 0,
      held: funnelAgg?.held.count ?? 0,
      completed: funnelAgg?.completed.count ?? 0,
    };

    // Completed vs remaining per area — top 8 busiest areas. Busiest is the
    // row count, which is completed + remaining by construction.
    const byAreaQuery = await this.quests.aggregate({
      select: {
        area: true,
        id: { count: true },
        completed: completedCount,
        remaining: remainingCount,
      },
      where: scope,
      groupBy: ["area"],
      orderBy: { column: "id.count", direction: "desc" },
      limit: top,
    });

    // A value whose work all finished outside the period adds nothing.
    const byArea = byAreaQuery
      .map((row) => ({
        area: row.area ?? "Unassigned",
        completed: row.completed.count,
        remaining: row.remaining.count,
      }))
      .filter((row) => row.completed + row.remaining > 0);

    // Completed vs remaining per priority, most urgent first.
    const byPriorityQuery = await this.quests.aggregate({
      select: {
        priority: true,
        completed: completedCount,
        remaining: remainingCount,
      },
      where: scope,
      groupBy: ["priority"],
    });

    const byPriority = byPriorityQuery
      .sort(byPriorityDesc)
      .map((row) => ({
        priority: row.priority,
        completed: row.completed.count,
        remaining: row.remaining.count,
      }))
      .filter((row) => row.completed + row.remaining > 0);

    /*
     * Completed vs remaining per tag.
     *
     * ⚠️ Folded in memory, and there is no SQL alternative to reach for.
     * `quests.tags` is a JSON array in a text column - the entity says so,
     * and every filter over it is a `like '%"value"%'` on the serialized
     * blob - so no `GROUP BY` reaches inside it on D1 or anywhere else.
     * `listQuestTags` reads the same two-column shape for the same reason.
     *
     * Two narrow columns over the project's in-scope quests, which is a
     * few hundred rows on the largest project this runs against, and it
     * rides the same loader rather than adding a round trip.
     *
     * ⚠️ A quest is counted once per tag it holds, so these rows do not sum
     * to the project's quest count. See `reportsQuestsSchema`.
     */
    const tagRows = await this.quests.findMany({
      where: scope,
      columns: ["tags", "completedAt"],
    });

    const tally = this.tagTally.tally(
      tagRows
        .filter(
          (row) => !row.completedAt || this.inWindow(row.completedAt, window),
        )
        .map((row) => ({
          tags: row.tags,
          completed: row.completedAt != null,
        })),
    );

    // Top N by volume, like `byArea`: a project with forty tags would
    // otherwise draw a chart nobody can read.
    const byTag = [...tally.entries()]
      .map(([tag, counts]) => ({ tag, ...counts }))
      .sort(
        (a, b) =>
          b.completed + b.remaining - (a.completed + a.remaining) ||
          a.tag.localeCompare(b.tag),
      )
      .slice(0, top);

    // Median and p85 cycle time per priority, most urgent first.
    const hoursByPriority = new Map<Quest["priority"], number[]>();
    for (const sample of await this.cycleSamples(scope, window)) {
      hoursByPriority.set(sample.priority, [
        ...(hoursByPriority.get(sample.priority) ?? []),
        sample.hours,
      ]);
    }
    const cycleTimeByPriority = [...hoursByPriority.entries()]
      .map(([priority, hours]) => ({
        priority,
        medianHours: this.stats.median(hours),
        p85Hours: this.stats.percentile(hours, 85),
      }))
      .sort(byPriorityDesc);

    // Oldest still-open (accepted, not completed) quests. A held quest is not
    // aging: it is waiting, and it shows as held.
    const agingQuery = await this.quests.findMany({
      where: {
        ...scope,
        acceptedAt: { isNotNull: true },
        completedAt: { isNull: true },
        heldAt: { isNull: true },
      },
      columns: ["shortId", "title", "area", "priority", "acceptedAt"],
      orderBy: { column: "acceptedAt", direction: "asc" },
      limit: query.agingLimit ?? 10,
    });

    const now = this.dt.nowMillis();
    const aging = agingQuery.map((row) => {
      // The where above guarantees it; the column is optional in the schema.
      const acceptedMs = row.acceptedAt
        ? this.dt.of(row.acceptedAt).valueOf()
        : now;
      return {
        shortId: row.shortId,
        title: row.title,
        area: row.area ?? "Unassigned",
        priority: row.priority,
        ageDays: Math.floor((now - acceptedMs) / 86400000),
      };
    });

    const previousWindow = this.previousWindow(query);
    const previous = previousWindow && {
      completed: await this.quests.count({
        ...scope,
        completedAt: this.completedWithin(previousWindow),
      }),
      ...this.cycleFigures(await this.cycleSamples(scope, previousWindow)),
    };

    return {
      funnel,
      byArea,
      byTag,
      byPriority,
      cycleTimeByPriority,
      ...(previous ? { previous } : {}),
      aging,
    };
  }

  /**
   * The project's members with what the report prints for them: "first last"
   * trimmed, else the username, else a short fallback derived from the uuid.
   */
  async membersOf(
    projectId: number,
  ): Promise<Array<{ userId: string; name: string; picture?: string }>> {
    const organizationId = (
      await this.projects.getOne({ where: { id: { eq: projectId } } })
    ).organizationId!;
    const userName = sql`
				COALESCE(
					NULLIF(TRIM(
						COALESCE(${this.users.table.firstName}, '') || ' ' || COALESCE(${this.users.table.lastName}, '')
					), ''),
					${this.users.table.username}
				)
			`;
    const rows = await this.database.run(
      sql`
					SELECT
						${this.members.table.userId} as user_id,
						${userName} as name,
						${this.users.table.picture} as picture
					FROM ${this.members.table}
					LEFT JOIN ${this.users.table}
						ON ${this.users.table.id} = ${this.members.table.userId}
					WHERE ${this.members.table.organizationId} = ${organizationId}
				`,
      z.object({
        user_id: z.string(),
        name: z.string().nullish(),
        picture: z.string().nullish(),
      }),
    );
    return rows.map((row) => ({
      userId: String(row.user_id),
      name: row.name ?? String(row.user_id).slice(0, 8),
      picture: row.picture ?? undefined,
    }));
  }
}

/**
 * A period's bounds, each optional: an absent `from` means no lower bound.
 */
interface ReportWindow {
  from?: string;
  to?: string;
}
