import { projects } from "@lore/core/schemas";
import {
  reportsMembersSchema,
  reportsOverviewSchema,
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

import { quests } from "../entities/quests.ts";
import { byPriorityDesc } from "../schemas/questPriority.ts";
import { EpicVisibilityService } from "./EpicVisibilityService.ts";
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

  /**
   * The "this quest is in scope" predicate every stats aggregate filters
   * on. Soft-deleted quests are gone; shelved quests were deliberately
   * set aside as out of scope, so they leave both the numerator and the
   * denominator of every chart — a release can hit 100% with shelved
   * quests left over.
   *
   * Completed-based metrics are unaffected by construction: only a "todo"
   * quest can be shelved, so a shelved quest is never a completed one.
   */
  protected get liveQuest() {
    return sql`${this.quests.table.deletedAt} IS NULL AND ${this.quests.table.shelvedAt} IS NULL`;
  }

  /**
   * `liveQuest`, additionally gated on the backlog: an **open** quest inside
   * a `draft` epic is specified and not released yet, so it leaves both
   * the numerator and the denominator the way a shelved one does. Every
   * aggregate below filters on this rather than on `liveQuest` directly, so
   * the KPI tiles, the burn-up and the per-area breakdown cannot disagree
   * about which quests exist.
   *
   * ⚠️ **Completed quests are exempt, and the exemption is the point.**
   * `liveQuest` needs no such carve-out because shelving carries an
   * invariant that makes one unnecessary: only a `todo` quest can be
   * shelved, so a shelved quest is never a completed one. Draft epics
   * carry no equivalent invariant: a completed quest may be filed into a
   * `draft` epic, and it keeps its `epicId` there. Gating those would retroactively erase real work from member
   * credit, the burn-up and the weekly contribution series. Completed work
   * is history; the gate answers "is this open to work on", which is not a
   * question a finished quest has.
   *
   * This is a row-level rule rather than a per-query one because it has to
   * be: the KPI aggregate, the funnel and both breakdowns count open and
   * completed quests in a **single pass**, so no choice of which queries to
   * gate could get them both right.
   *
   * The epic-membership test itself — and both of its traps — lives in
   * `EpicVisibilityService.draftEpicSqlPredicate`, which returns
   * `undefined` when there is no draft epic so no clause is emitted.
   */
  protected questInScope(draftEpicIds: number[]) {
    const outsidePlannedEpic =
      this.epicVisibility.draftEpicSqlPredicate(draftEpicIds);

    if (!outsidePlannedEpic) {
      return this.liveQuest;
    }

    return sql`${this.liveQuest} AND (${this.quests.table.completedAt} IS NOT NULL OR ${outsidePlannedEpic})`;
  }

  /**
   * {@link questInScope} as a where-object, for the reads that go through the
   * repository. Same rule, same two traps: the soft delete is the
   * repository's own filter, the `isNull` branch keeps a quest with no epic
   * (`epic_id NOT IN (…)` is NULL for it), and an empty draft set adds no
   * clause at all. `QuestTagTallyService.rowsFor` spells the same rule for
   * several projects.
   */
  protected questScope(
    projectId: number,
    draftEpicIds: number[],
  ): PgQueryWhere<typeof quests.schema> {
    const where: PgQueryWhere<typeof quests.schema> = {
      projectId: { eq: projectId },
      shelvedAt: { isNull: true },
    };
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
   * Quests created per day over the project's lifetime, in scope.
   *
   * The burn-up's left half, and the dashboard's burn-up tile (#Q2653) reads
   * it from here rather than restating the query. `scope` defaults to the
   * project's own {@link questScope}.
   */
  async createdByDay(
    projectId: number,
    scope?: PgQueryWhere<typeof quests.schema>,
  ): Promise<Array<{ date: string; count: number }>> {
    const where =
      scope ??
      this.questScope(
        projectId,
        await this.epicVisibility.draftEpicIds(projectId),
      );
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
    scope?: PgQueryWhere<typeof quests.schema>,
  ): Promise<Array<{ date: string; count: number }>> {
    const where =
      scope ??
      this.questScope(
        projectId,
        await this.epicVisibility.draftEpicIds(projectId),
      );
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
   * Reports "Overview" tab: KPI tiles, a cumulative created-vs-completed
   * burn-up chart, a weekly completion-rate trend, and counts of quests that
   * need attention (stale, unassigned, blocked).
   *
   * Members-only. Every date computation
   * dialect-branches (SQLite epoch-ms ints in production, Postgres timestamps
   * in tests).
   */
  async overview(
    projectId: number,
  ): Promise<Infer<typeof reportsOverviewSchema>> {
    const params = { id: projectId };
    const organizationId = (
      await this.projects.getOne({ where: { id: { eq: params.id } } })
    ).organizationId!;
    const scope = this.questScope(
      params.id,
      await this.epicVisibility.draftEpicIds(params.id),
    );

    // Week windows bound on the app clock (`DateTimeProvider`), not the
    // database's: the where-object encodes them for the column on both
    // dialects.
    const weekAgo = this.dt.now().subtract(7, "day").toISOString();
    const twoWeeksAgo = this.dt.now().subtract(14, "day").toISOString();
    const cycleHours = this.sqlx.dateDiff(
      this.quests.table.completedAt,
      this.quests.table.acceptedAt,
      "hours",
    );

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
        cycleTime: {
          avg: {
            expr: cycleHours,
            where: {
              acceptedAt: { isNotNull: true },
              completedAt: { isNotNull: true },
            },
          },
        },
      },
      where: scope,
    });

    const activeMembers = await this.members.count({
      organizationId: { eq: organizationId },
    });

    const kpis = {
      totalQuests: Number(kpiAgg?.totalQuests.count) || 0,
      completedQuests: Number(kpiAgg?.completedQuests.count) || 0,
      openQuests: Number(kpiAgg?.openQuests.count) || 0,
      completedThisWeek: Number(kpiAgg?.completedThisWeek.count) || 0,
      completedLastWeek: Number(kpiAgg?.completedLastWeek.count) || 0,
      avgCycleTimeHours: Number(kpiAgg?.cycleTime.avg) || 0,
      activeMembers,
    };

    // Daily created and completed counts over the project's lifetime.
    const createdByDay = await this.createdByDay(params.id, scope);
    const completedByDay = await this.completedByDay(params.id, scope);

    // Merge into a sorted date axis and accumulate running totals.
    const createdMap = new Map(
      createdByDay.map((r) => [r.date, Number(r.count)]),
    );
    const completedMap = new Map(
      completedByDay.map((r) => [r.date, Number(r.count)]),
    );
    const axis = Array.from(
      new Set([...createdMap.keys(), ...completedMap.keys()]),
    ).sort();

    let runningCreated = 0;
    let runningCompleted = 0;
    let burnup = axis.map((date) => {
      runningCreated += createdMap.get(date) ?? 0;
      runningCompleted += completedMap.get(date) ?? 0;
      return {
        date,
        created: runningCreated,
        completed: runningCompleted,
      };
    });
    // Cap to the most recent 90 points.
    if (burnup.length > 90) {
      burnup = burnup.slice(burnup.length - 90);
    }

    // Weekly completion-rate trend — sample every 7th burn-up point plus
    // the last so the latest cumulative figure is always represented.
    const completionTrend: { date: string; rate: number }[] = [];
    for (let i = 0; i < burnup.length; i += 7) {
      const p = burnup[i];
      completionTrend.push({
        date: p.date,
        rate: p.created > 0 ? Math.round((p.completed / p.created) * 100) : 0,
      });
    }
    const last = burnup[burnup.length - 1];
    if (
      last &&
      completionTrend[completionTrend.length - 1]?.date !== last.date
    ) {
      completionTrend.push({
        date: last.date,
        rate:
          last.created > 0
            ? Math.round((last.completed / last.created) * 100)
            : 0,
      });
    }

    // Attention counts. A quest is blocked while the one it depends on is
    // still open: `subquery` correlates through the outer `depends_on`.
    const [attentionAgg] = await this.quests.aggregate({
      select: {
        staleQuests: {
          count: {
            column: "id",
            where: {
              acceptedAt: { isNotNull: true, lt: twoWeeksAgo },
              completedAt: { isNull: true },
            },
          },
        },
        unassignedQuests: {
          count: {
            column: "id",
            where: {
              acceptedAt: { isNull: true },
              completedAt: { isNull: true },
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
      unassignedQuests: Number(attentionAgg?.unassignedQuests.count) || 0,
      blockedQuests: Number(attentionAgg?.blockedQuests.count) || 0,
    };

    return {
      kpis,
      burnup,
      completionTrend,
      attention,
    };
  }

  /**
   * Reports "Quests" tab: a lifecycle funnel (to do → in progress → completed),
   * completed-vs-remaining breakdowns by area and by priority, average cycle
   * time per priority, and an actionable list of the oldest still-open quests.
   *
   * Same access model as `getReportsOverview`: members-only. Date
   * computations dialect-branch (SQLite epoch-ms integers on D1, Postgres
   * timestamps on node).
   */
  async questsReport(
    projectId: number,
  ): Promise<Infer<typeof reportsQuestsSchema>> {
    const params = { id: projectId };
    const draftEpicIds = await this.epicVisibility.draftEpicIds(params.id);
    const scope = this.questScope(params.id, draftEpicIds);

    // The two halves every breakdown splits on. `column: "id"` because a
    // conditioned COUNT skips NULLs of the column it counts, and the key is
    // never null.
    const completedCount = {
      count: { column: "id", where: { completedAt: { isNotNull: true } } },
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
            },
          },
        },
        inProgress: {
          count: {
            column: "id",
            where: {
              acceptedAt: { isNotNull: true },
              completedAt: { isNull: true },
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
      limit: 8,
    });

    const byArea = byAreaQuery.map((row) => ({
      area: row.area ?? "Unassigned",
      completed: row.completed.count,
      remaining: row.remaining.count,
    }));

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

    const byPriority = byPriorityQuery.sort(byPriorityDesc).map((row) => ({
      priority: row.priority,
      completed: row.completed.count,
      remaining: row.remaining.count,
    }));

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
      tagRows.map((row) => ({
        tags: row.tags,
        completed: row.completedAt != null,
      })),
    );

    // Top 8 by volume, like `byArea`: a project with forty tags would
    // otherwise draw a chart nobody can read.
    const byTag = [...tally.entries()]
      .map(([tag, counts]) => ({ tag, ...counts }))
      .sort(
        (a, b) =>
          b.completed + b.remaining - (a.completed + a.remaining) ||
          a.tag.localeCompare(b.tag),
      )
      .slice(0, 8);

    // Average cycle time per priority, only quests with both timestamps,
    // most urgent first.
    const cycleTimeQuery = await this.quests.aggregate({
      select: {
        priority: true,
        cycleTime: {
          avg: {
            expr: this.sqlx.dateDiff(
              this.quests.table.completedAt,
              this.quests.table.acceptedAt,
              "hours",
            ),
          },
        },
      },
      where: {
        ...scope,
        acceptedAt: { isNotNull: true },
        completedAt: { isNotNull: true },
      },
      groupBy: ["priority"],
    });

    const cycleTimeByPriority = cycleTimeQuery
      .sort(byPriorityDesc)
      .map((row) => ({
        priority: String(row.priority),
        avgHours: Number(row.cycleTime.avg) || 0,
      }));

    // Oldest still-open (accepted, not completed) quests.
    const agingQuery = await this.quests.findMany({
      where: {
        ...scope,
        acceptedAt: { isNotNull: true },
        completedAt: { isNull: true },
      },
      columns: ["shortId", "title", "area", "priority", "acceptedAt"],
      orderBy: { column: "acceptedAt", direction: "asc" },
      limit: 10,
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

    return {
      funnel,
      byArea,
      byTag,
      byPriority,
      cycleTimeByPriority,
      aging,
    };
  }

  /**
   * Reports "Members" tab: a per-member leaderboard (completed quests), a
   * weekly per-contributor contribution matrix for a stacked-area chart, and
   * an "idle" list of members who have not completed a quest in the last 14
   * days.
   *
   * Same access model as `getReportsOverview`: members-only. Date
   * computations dialect-branch (SQLite epoch-ms integers on D1, Postgres
   * timestamps on node).
   */
  async membersReport(
    projectId: number,
  ): Promise<Infer<typeof reportsMembersSchema>> {
    const params = { id: projectId };
    const organizationId = (
      await this.projects.getOne({ where: { id: { eq: params.id } } })
    ).organizationId!;
    const draftEpicIds = await this.epicVisibility.draftEpicIds(params.id);
    const inScope = this.questInScope(draftEpicIds);
    const scope = this.questScope(params.id, draftEpicIds);

    // Compose a user's display name: "first last" trimmed, else username,
    // else a short fallback derived from the uuid.
    const userName = sql`
				COALESCE(
					NULLIF(TRIM(
						COALESCE(${this.users.table.firstName}, '') || ' ' || COALESCE(${this.users.table.lastName}, '')
					), ''),
					${this.users.table.username}
				)
			`;

    // Leaderboard — one row per member in the project, LEFT-JOINed to
    // the per-user completed-quest count and the users table for the name.
    const leaderboardQuery = await this.database.run(
      sql`
					SELECT
						${this.members.table.userId} as user_id,
						${userName} as name,
						${this.users.table.picture} as picture,
						COALESCE(q.completed_count, 0) as quests_completed
					FROM ${this.members.table}
					LEFT JOIN ${this.users.table}
						ON ${this.users.table.id} = ${this.members.table.userId}
					LEFT JOIN (
						SELECT
							${this.quests.table.completedBy} as completed_by,
							COUNT(*) as completed_count
						FROM ${this.quests.table}
						WHERE ${this.quests.table.projectId} = ${params.id}
							AND ${this.quests.table.completedAt} IS NOT NULL
							AND ${inScope}
						GROUP BY ${this.quests.table.completedBy}
					) q ON q.completed_by = ${this.members.table.userId}
					WHERE ${this.members.table.organizationId} = ${organizationId}
					ORDER BY quests_completed DESC
				`,
      z.object({
        user_id: z.string(),
        name: z.string().nullish(),
        picture: z.string().nullish(),
        quests_completed: z.coerce.number(),
      }),
    );

    const leaderboard = leaderboardQuery.map((row) => ({
      userId: String(row.user_id),
      name: row.name ?? String(row.user_id).slice(0, 8),
      picture: row.picture ?? undefined,
      questsCompleted: Number(row.quests_completed) || 0,
    }));

    // Top 5 contributors by completed quests (only those with completions).
    const contributorRows = leaderboard
      .filter((row) => row.questsCompleted > 0)
      .slice(0, 5);
    const contributors = contributorRows.map((row) => row.name);
    const contributorByUserId = new Map(
      contributorRows.map((row) => [row.userId, row.name]),
    );

    // Weekly completion buckets per user over (roughly) the last 8 weeks.
    // `week` is a sortable ISO label ("2026-W11") on both dialects.
    const eightWeeksAgo = this.dt.now().subtract(56, "day").toISOString();
    const contributionQuery = (
      await this.quests.aggregate({
        select: {
          week: { expr: this.sqlx.dateWeek(this.quests.table.completedAt) },
          completedBy: true,
          quests: { count: { column: "id" } },
        },
        where: {
          ...scope,
          completedAt: { isNotNull: true, gte: eightWeeksAgo },
        },
        groupBy: ["week", "completedBy"],
      })
    ).map((row) => ({
      week: String(row.week),
      completed_by: row.completedBy,
      count: row.quests.count,
    }));

    // Pivot: week axis × contributor name → count.
    const weeks = Array.from(
      new Set(contributionQuery.map((r) => String(r.week))),
    ).sort();
    const countsByWeek = new Map<string, Record<string, number>>();
    for (const week of weeks) {
      const counts: Record<string, number> = {};
      for (const name of contributors) {
        counts[name] = 0;
      }
      countsByWeek.set(week, counts);
    }
    for (const row of contributionQuery) {
      const name = row.completed_by
        ? contributorByUserId.get(String(row.completed_by))
        : undefined;
      if (!name) continue;
      const counts = countsByWeek.get(String(row.week));
      if (counts) {
        counts[name] = (counts[name] ?? 0) + Number(row.count);
      }
    }
    const contribution = weeks.map((week) => ({
      date: week,
      counts: countsByWeek.get(week) ?? {},
    }));

    // Idle members — most recent completed quest older than 14 days, or
    // never completed one.
    const lastCompletedQuery = await this.quests.aggregate({
      select: { completedBy: true, completedAt: { max: true } },
      where: { ...scope, completedAt: { isNotNull: true } },
      groupBy: ["completedBy"],
    });

    const lastCompletedByUserId = new Map<string, string>();
    for (const row of lastCompletedQuery) {
      if (row.completedBy && row.completedAt.max != null) {
        lastCompletedByUserId.set(row.completedBy, row.completedAt.max);
      }
    }

    const now = this.dt.nowMillis();
    const idle = leaderboard
      .map((member) => {
        // Decoded by the column, so an ISO timestamp on both dialects.
        const raw = lastCompletedByUserId.get(member.userId);
        const lastMs = raw == null ? undefined : this.dt.of(raw).valueOf();
        return { member, raw, lastMs };
      })
      .filter(
        ({ lastMs }) => lastMs === undefined || now - lastMs > 14 * 86400000,
      )
      .map(({ member, raw }) => ({
        userId: member.userId,
        name: member.name,
        picture: member.picture,
        lastCompletedAt: raw ?? undefined,
      }));

    return {
      leaderboard,
      contributors,
      contribution,
      idle,
    };
  }
}
