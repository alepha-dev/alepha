import { $inject, z } from "alepha";
import { users } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import {
  $repository,
  DatabaseProvider,
  SqlExpressionProvider,
  sql,
} from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { $etag } from "alepha/server/etag";

import { members } from "../entities/members.ts";
import { projects } from "../entities/projects.ts";
import { quests } from "../entities/quests.ts";
import { QUEST_PRIORITY_ORDER } from "../schemas/questPriority.ts";
import {
  reportsMembersSchema,
  reportsOverviewSchema,
  reportsQuestsSchema,
} from "../schemas/reportsSchemas.ts";
import { EpicVisibilityService } from "../services/EpicVisibilityService.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

export class ProjectReportsController {
  quests = $repository(quests);
  members = $repository(members);
  projects = $repository(projects);
  users = $repository(users);
  database = $inject(DatabaseProvider);
  sqlx = $inject(SqlExpressionProvider);
  security = $inject(ProjectSecurityService);
  epicVisibility = $inject(EpicVisibilityService);
  dt = $inject(DateTimeProvider);

  /**
   * The "this quest is in scope" predicate every stats aggregate filters
   * on. Soft-deleted quests are gone; shelved quests were deliberately
   * set aside as out of scope, so they leave both the numerator and the
   * denominator of every chart — a release can hit 100% with shelved
   * quests left over.
   *
   * Completed-based metrics are unaffected by construction: only a "new"
   * quest can be shelved, so a shelved quest is never a completed one.
   */
  protected get liveQuest() {
    return sql`${this.quests.table.deletedAt} IS NULL AND ${this.quests.table.shelvedAt} IS NULL`;
  }

  /**
   * `liveQuest`, additionally gated on the backlog: an **open** quest inside
   * a `planned` epic is specified and not released yet, so it leaves both
   * the numerator and the denominator the way a shelved one does. Every
   * aggregate below filters on this rather than on `liveQuest` directly, so
   * the KPI tiles, the burn-up and the per-area breakdown cannot disagree
   * about which quests exist.
   *
   * ⚠️ **Completed quests are exempt, and the exemption is the point.**
   * `liveQuest` needs no such carve-out because shelving carries an
   * invariant that makes one unnecessary: only a `new` quest can be
   * shelved, so a shelved quest is never a completed one. Planned epics
   * carry no equivalent invariant — nothing stops an owner flipping a
   * `done` epic back to `planned` while its finished quests keep their
   * `epicId`. Gating those would retroactively erase real work from member
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
   * `EpicVisibilityService.plannedEpicSqlPredicate`, which returns
   * `undefined` when there is no planned epic so no clause is emitted.
   */
  protected questInScope(plannedEpicIds: number[]) {
    const outsidePlannedEpic =
      this.epicVisibility.plannedEpicSqlPredicate(plannedEpicIds);

    if (!outsidePlannedEpic) {
      return this.liveQuest;
    }

    return sql`${this.liveQuest} AND (${this.quests.table.completedAt} IS NOT NULL OR ${outsidePlannedEpic})`;
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
  getReportsOverview = $action({
    use: [
      $secure({ permissions: ["stats:read"] }),
      $etag({
        control: { private: true, maxAge: 60, staleWhileRevalidate: 300 },
      }),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: reportsOverviewSchema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.id, user);

      const inScope = this.questInScope(
        await this.epicVisibility.plannedEpicIds(params.id),
      );

      const daysAgo = (days: number) => this.sqlx.ago(days, "days");
      const createdAtDay = this.sqlx.dateDay(this.quests.table.createdAt);
      const completedAtDay = this.sqlx.dateDay(this.quests.table.completedAt);
      const cycleHours = sql`AVG(${this.sqlx.dateDiff(
        this.quests.table.completedAt,
        this.quests.table.acceptedAt,
        "hours",
      )})`;

      // KPI aggregate — single pass over the project's live quests.
      const [kpiAgg] = await this.database.run(
        sql`
					SELECT
						COUNT(*) as total_quests,
						COUNT(CASE WHEN ${this.quests.table.completedAt} IS NOT NULL THEN 1 END) as completed_quests,
						COUNT(CASE WHEN ${this.quests.table.acceptedAt} IS NOT NULL AND ${this.quests.table.completedAt} IS NULL THEN 1 END) as open_quests,
						COUNT(CASE WHEN ${this.quests.table.completedAt} >= ${daysAgo(7)} THEN 1 END) as completed_this_week,
						COUNT(CASE WHEN ${this.quests.table.completedAt} >= ${daysAgo(14)} AND ${this.quests.table.completedAt} < ${daysAgo(7)} THEN 1 END) as completed_last_week,
						COALESCE((
							SELECT ${cycleHours}
							FROM ${this.quests.table}
							WHERE ${this.quests.table.projectId} = ${params.id}
								AND ${inScope}
								AND ${this.quests.table.acceptedAt} IS NOT NULL
								AND ${this.quests.table.completedAt} IS NOT NULL
						), 0) as avg_cycle_time_hours
					FROM ${this.quests.table}
					WHERE ${this.quests.table.projectId} = ${params.id}
						AND ${inScope}
				`,
        z.object({
          total_quests: z.coerce.number(),
          completed_quests: z.coerce.number(),
          open_quests: z.coerce.number(),
          completed_this_week: z.coerce.number(),
          completed_last_week: z.coerce.number(),
          avg_cycle_time_hours: z.coerce.number(),
        }),
      );

      const [memberAgg] = await this.database.run(
        sql`
					SELECT COUNT(*) as active_members
					FROM ${this.members.table}
					WHERE ${this.members.table.projectId} = ${params.id}
				`,
        z.object({
          active_members: z.coerce.number(),
        }),
      );

      const kpis = {
        totalQuests: Number(kpiAgg?.total_quests) || 0,
        completedQuests: Number(kpiAgg?.completed_quests) || 0,
        openQuests: Number(kpiAgg?.open_quests) || 0,
        completedThisWeek: Number(kpiAgg?.completed_this_week) || 0,
        completedLastWeek: Number(kpiAgg?.completed_last_week) || 0,
        avgCycleTimeHours: Number(kpiAgg?.avg_cycle_time_hours) || 0,
        activeMembers: Number(memberAgg?.active_members) || 0,
      };

      // Daily created counts over the project's lifetime.
      const createdByDay = await this.database.run(
        sql`
					SELECT
						${createdAtDay} as date,
						COUNT(*) as count
					FROM ${this.quests.table}
					WHERE ${this.quests.table.projectId} = ${params.id}
						AND ${inScope}
					GROUP BY ${createdAtDay}
				`,
        z.object({
          date: z.string(),
          count: z.coerce.number(),
        }),
      );

      // Daily completed counts over the project's lifetime.
      const completedByDay = await this.database.run(
        sql`
					SELECT
						${completedAtDay} as date,
						COUNT(*) as count
					FROM ${this.quests.table}
					WHERE ${this.quests.table.projectId} = ${params.id}
						AND ${inScope}
						AND ${this.quests.table.completedAt} IS NOT NULL
					GROUP BY ${completedAtDay}
				`,
        z.object({
          date: z.string(),
          count: z.coerce.number(),
        }),
      );

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

      // Attention counts.
      const [attentionAgg] = await this.database.run(
        sql`
					SELECT
						COUNT(CASE WHEN ${this.quests.table.acceptedAt} IS NOT NULL AND ${this.quests.table.completedAt} IS NULL AND ${this.quests.table.acceptedAt} < ${daysAgo(14)} THEN 1 END) as stale_quests,
						COUNT(CASE WHEN ${this.quests.table.acceptedAt} IS NULL AND ${this.quests.table.completedAt} IS NULL THEN 1 END) as unassigned_quests,
						COUNT(CASE WHEN ${this.quests.table.completedAt} IS NULL AND ${this.quests.table.dependsOn} IS NOT NULL AND EXISTS (
							SELECT 1 FROM ${this.quests.table} d
							WHERE d.id = ${this.quests.table.dependsOn}
								AND d.completed_at IS NULL
								AND d.deleted_at IS NULL
						) THEN 1 END) as blocked_quests
					FROM ${this.quests.table}
					WHERE ${this.quests.table.projectId} = ${params.id}
						AND ${inScope}
				`,
        z.object({
          stale_quests: z.coerce.number(),
          unassigned_quests: z.coerce.number(),
          blocked_quests: z.coerce.number(),
        }),
      );

      const attention = {
        staleQuests: Number(attentionAgg?.stale_quests) || 0,
        unassignedQuests: Number(attentionAgg?.unassigned_quests) || 0,
        blockedQuests: Number(attentionAgg?.blocked_quests) || 0,
      };

      return {
        kpis,
        burnup,
        completionTrend,
        attention,
      };
    },
  });

  /**
   * Reports "Quests" tab: a lifecycle funnel (new → accepted → completed),
   * completed-vs-remaining breakdowns by area and by priority, average cycle
   * time per priority, and an actionable list of the oldest still-open quests.
   *
   * Same access model as `getReportsOverview`: members-only. Date
   * computations dialect-branch (SQLite epoch-ms integers on D1, Postgres
   * timestamps on node).
   */
  getReportsQuests = $action({
    use: [
      $secure({ permissions: ["stats:read"] }),
      $etag({
        control: { private: true, maxAge: 60, staleWhileRevalidate: 300 },
      }),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: reportsQuestsSchema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.id, user);

      const inScope = this.questInScope(
        await this.epicVisibility.plannedEpicIds(params.id),
      );

      const cycleHours = sql`COALESCE(AVG(${this.sqlx.dateDiff(
        this.quests.table.completedAt,
        this.quests.table.acceptedAt,
        "hours",
      )}), 0)`;
      // Built from the shared ordinal rather than restating it, so the one
      // place that knows `priority` is a text enum stays the only place
      // that knows. Negated because higher rank means higher urgency and
      // this ORDER BY is ascending.
      const priorityOrder = sql`
				CASE ${this.quests.table.priority}
					WHEN 'high' THEN ${-QUEST_PRIORITY_ORDER.high}
					WHEN 'medium' THEN ${-QUEST_PRIORITY_ORDER.medium}
					WHEN 'low' THEN ${-QUEST_PRIORITY_ORDER.low}
					WHEN 'optional' THEN ${-QUEST_PRIORITY_ORDER.optional}
				END
			`;

      // Lifecycle funnel — single pass over the project's live quests.
      const [funnelAgg] = await this.database.run(
        sql`
					SELECT
						COUNT(CASE WHEN ${this.quests.table.acceptedAt} IS NULL AND ${this.quests.table.completedAt} IS NULL THEN 1 END) as new_count,
						COUNT(CASE WHEN ${this.quests.table.acceptedAt} IS NOT NULL AND ${this.quests.table.completedAt} IS NULL THEN 1 END) as accepted_count,
						COUNT(CASE WHEN ${this.quests.table.completedAt} IS NOT NULL THEN 1 END) as completed_count
					FROM ${this.quests.table}
					WHERE ${this.quests.table.projectId} = ${params.id}
						AND ${inScope}
				`,
        z.object({
          new_count: z.coerce.number(),
          accepted_count: z.coerce.number(),
          completed_count: z.coerce.number(),
        }),
      );

      const funnel = {
        new: Number(funnelAgg?.new_count) || 0,
        accepted: Number(funnelAgg?.accepted_count) || 0,
        completed: Number(funnelAgg?.completed_count) || 0,
      };

      // Completed vs remaining per area — top 8 busiest areas.
      const byAreaQuery = await this.database.run(
        sql`
					SELECT
						COALESCE(${this.quests.table.area}, 'Unassigned') as area,
						COUNT(CASE WHEN ${this.quests.table.completedAt} IS NOT NULL THEN 1 END) as completed,
						COUNT(CASE WHEN ${this.quests.table.completedAt} IS NULL THEN 1 END) as remaining
					FROM ${this.quests.table}
					WHERE ${this.quests.table.projectId} = ${params.id}
						AND ${inScope}
					GROUP BY ${this.quests.table.area}
					ORDER BY (
						COUNT(CASE WHEN ${this.quests.table.completedAt} IS NOT NULL THEN 1 END)
						+ COUNT(CASE WHEN ${this.quests.table.completedAt} IS NULL THEN 1 END)
					) DESC
					LIMIT 8
				`,
        z.object({
          area: z.string(),
          completed: z.coerce.number(),
          remaining: z.coerce.number(),
        }),
      );

      const byArea = byAreaQuery.map((row) => ({
        area: String(row.area),
        completed: Number(row.completed) || 0,
        remaining: Number(row.remaining) || 0,
      }));

      // Completed vs remaining per priority.
      const byPriorityQuery = await this.database.run(
        sql`
					SELECT
						${this.quests.table.priority},
						COUNT(CASE WHEN ${this.quests.table.completedAt} IS NOT NULL THEN 1 END) as completed,
						COUNT(CASE WHEN ${this.quests.table.completedAt} IS NULL THEN 1 END) as remaining
					FROM ${this.quests.table}
					WHERE ${this.quests.table.projectId} = ${params.id}
						AND ${inScope}
					GROUP BY ${this.quests.table.priority}
					ORDER BY ${priorityOrder}
				`,
        z.object({
          priority: z.string(),
          completed: z.coerce.number(),
          remaining: z.coerce.number(),
        }),
      );

      const byPriority = byPriorityQuery.map((row) => ({
        priority: String(row.priority),
        completed: Number(row.completed) || 0,
        remaining: Number(row.remaining) || 0,
      }));

      // Average cycle time per priority — only quests with both timestamps.
      const cycleTimeQuery = await this.database.run(
        sql`
					SELECT
						${this.quests.table.priority},
						${cycleHours} as avg_hours
					FROM ${this.quests.table}
					WHERE ${this.quests.table.projectId} = ${params.id}
						AND ${inScope}
						AND ${this.quests.table.acceptedAt} IS NOT NULL
						AND ${this.quests.table.completedAt} IS NOT NULL
					GROUP BY ${this.quests.table.priority}
					ORDER BY ${priorityOrder}
				`,
        z.object({
          priority: z.string(),
          avg_hours: z.coerce.number(),
        }),
      );

      const cycleTimeByPriority = cycleTimeQuery.map((row) => ({
        priority: String(row.priority),
        avgHours: Number(row.avg_hours) || 0,
      }));

      // Oldest still-open (accepted, not completed) quests.
      const agingQuery = await this.database.run(
        sql`
					SELECT
						${this.quests.table.shortId} as short_id,
						${this.quests.table.title} as title,
						${this.quests.table.area} as area,
						${this.quests.table.priority} as priority,
						${this.quests.table.acceptedAt} as accepted_at
					FROM ${this.quests.table}
					WHERE ${this.quests.table.projectId} = ${params.id}
						AND ${inScope}
						AND ${this.quests.table.acceptedAt} IS NOT NULL
						AND ${this.quests.table.completedAt} IS NULL
					ORDER BY ${this.quests.table.acceptedAt} ASC
					LIMIT 10
				`,
        z.object({
          short_id: z.coerce.number(),
          title: z.string(),
          area: z.string().nullish(),
          priority: z.string(),
          accepted_at: z.union([z.string(), z.number()]),
        }),
      );

      const now = this.dt.nowMillis();
      const aging = agingQuery.map((row) => {
        // `accepted_at` is epoch-ms from SQLite and an ISO timestamp from
        // Postgres — `new Date()` parses both (a numeric-ms string is
        // coerced to a number first).
        const acceptedMs = Number.isNaN(Number(row.accepted_at))
          ? new Date(row.accepted_at).getTime()
          : Number(row.accepted_at);
        return {
          shortId: Number(row.short_id) || 0,
          title: String(row.title),
          area: row.area ?? "Unassigned",
          priority: String(row.priority),
          ageDays: Math.floor((now - acceptedMs) / 86400000),
        };
      });

      return {
        funnel,
        byArea,
        byPriority,
        cycleTimeByPriority,
        aging,
      };
    },
  });

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
  getReportsMembers = $action({
    use: [
      $secure({ permissions: ["stats:read"] }),
      $etag({
        control: { private: true, maxAge: 60, staleWhileRevalidate: 300 },
      }),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: reportsMembersSchema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.id, user);

      const inScope = this.questInScope(
        await this.epicVisibility.plannedEpicIds(params.id),
      );

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
					WHERE ${this.members.table.projectId} = ${params.id}
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
      const weekBucket = this.sqlx.dateWeek(this.quests.table.completedAt);
      const weeksAgo = this.sqlx.ago(56, "days");

      const contributionQuery = await this.database.run(
        sql`
					SELECT
						${weekBucket} as week,
						${this.quests.table.completedBy} as completed_by,
						COUNT(*) as count
					FROM ${this.quests.table}
					WHERE ${this.quests.table.projectId} = ${params.id}
						AND ${this.quests.table.completedAt} IS NOT NULL
						AND ${inScope}
						AND ${this.quests.table.completedAt} >= ${weeksAgo}
					GROUP BY week, ${this.quests.table.completedBy}
				`,
        z.object({
          week: z.string(),
          completed_by: z.string().nullish(),
          count: z.coerce.number(),
        }),
      );

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
      const lastCompletedQuery = await this.database.run(
        sql`
					SELECT
						${this.quests.table.completedBy} as completed_by,
						MAX(${this.quests.table.completedAt}) as last_completed_at
					FROM ${this.quests.table}
					WHERE ${this.quests.table.projectId} = ${params.id}
						AND ${this.quests.table.completedAt} IS NOT NULL
						AND ${inScope}
					GROUP BY ${this.quests.table.completedBy}
				`,
        z.object({
          completed_by: z.string().nullish(),
          last_completed_at: z.union([z.string(), z.number()]).nullish(),
        }),
      );

      const lastCompletedByUserId = new Map<string, string>();
      for (const row of lastCompletedQuery) {
        if (row.completed_by && row.last_completed_at != null) {
          lastCompletedByUserId.set(
            String(row.completed_by),
            String(row.last_completed_at),
          );
        }
      }

      const now = this.dt.nowMillis();
      const idle = leaderboard
        .map((member) => {
          const raw = lastCompletedByUserId.get(member.userId);
          // `raw` is epoch-ms from SQLite, an ISO timestamp from Postgres.
          const lastMs =
            raw == null
              ? undefined
              : Number.isNaN(Number(raw))
                ? new Date(raw).getTime()
                : Number(raw);
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
    },
  });
}
