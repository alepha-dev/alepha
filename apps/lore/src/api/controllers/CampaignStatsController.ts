import { $inject, t } from "alepha";
import { users } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DatabaseProvider, sql } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, ForbiddenError } from "alepha/server";
import { $etag } from "alepha/server/etag";
import { campaigns } from "../entities/campaigns.ts";
import { characters } from "../entities/characters.ts";
import { quests } from "../entities/quests.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import {
  chroniclesOverviewSchema,
  chroniclesPartySchema,
  chroniclesQuestsSchema,
} from "../schemas/chroniclesSchemas.ts";
import { FeaturePaywallService } from "../services/FeaturePaywallService.ts";

export class CampaignStatsController {
  quests = $repository(quests);
  characters = $repository(characters);
  campaigns = $repository(campaigns);
  users = $repository(users);
  database = $inject(DatabaseProvider);
  security = $inject(AppSecurityProvider);
  dt = $inject(DateTimeProvider);
  paywall = $inject(FeaturePaywallService);

  /**
   * Chronicles "Overview" tab: KPI tiles, a cumulative created-vs-completed
   * burn-up chart, a weekly completion-rate trend, and counts of quests that
   * need attention (stale, unassigned, blocked).
   *
   * Members-only + the `chronicles` paywall. Every date computation
   * dialect-branches (SQLite epoch-ms ints in production, Postgres timestamps
   * in tests).
   */
  getChroniclesOverview = $action({
    use: [
      $secure({ permissions: ["stats:read"] }),
      $etag({
        control: { private: true, maxAge: 60, staleWhileRevalidate: 300 },
      }),
    ],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: chroniclesOverviewSchema,
    },
    handler: async ({ params, user }) => {
      const { campaign } = await this.security.assertMember(params.id, user);

      if (!this.paywall.isUnlocked(campaign.unlockedFeatures, "chronicles")) {
        throw new ForbiddenError(
          "Chronicles is locked — buy it from the Shop.",
        );
      }

      const isSqlite = this.database.dialect === "sqlite";
      const daysAgo = (days: number) =>
        isSqlite
          ? sql.raw(`(strftime('%s', 'now', '-${days} days') * 1000)`)
          : sql.raw(`CURRENT_DATE - INTERVAL '${days} days'`);
      const createdAtDay = isSqlite
        ? sql`DATE(${this.quests.table.createdAt} / 1000, 'unixepoch')`
        : sql`DATE(${this.quests.table.createdAt})`;
      const completedAtDay = isSqlite
        ? sql`DATE(${this.quests.table.completedAt} / 1000, 'unixepoch')`
        : sql`DATE(${this.quests.table.completedAt})`;
      // Cycle time = completedAt - acceptedAt expressed in hours. SQLite
      // stores epoch-ms integers (divide by 3.6M); Postgres stores
      // timestamps (EXTRACT EPOCH gives seconds, divide by 3600).
      const cycleHours = isSqlite
        ? sql`AVG(${this.quests.table.completedAt} - ${this.quests.table.acceptedAt}) / 3600000.0`
        : sql`AVG(EXTRACT(EPOCH FROM (${this.quests.table.completedAt} - ${this.quests.table.acceptedAt}))) / 3600.0`;

      // KPI aggregate — single pass over the campaign's live quests.
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
							WHERE ${this.quests.table.campaignId} = ${params.id}
								AND ${this.quests.table.deletedAt} IS NULL
								AND ${this.quests.table.acceptedAt} IS NOT NULL
								AND ${this.quests.table.completedAt} IS NOT NULL
						), 0) as avg_cycle_time_hours
					FROM ${this.quests.table}
					WHERE ${this.quests.table.campaignId} = ${params.id}
						AND ${this.quests.table.deletedAt} IS NULL
				`,
        t.object({
          total_quests: t.string(),
          completed_quests: t.string(),
          open_quests: t.string(),
          completed_this_week: t.string(),
          completed_last_week: t.string(),
          avg_cycle_time_hours: t.string(),
        }),
      );

      const [characterAgg] = await this.database.run(
        sql`
					SELECT COUNT(*) as active_characters
					FROM ${this.characters.table}
					WHERE ${this.characters.table.campaignId} = ${params.id}
				`,
        t.object({
          active_characters: t.string(),
        }),
      );

      const kpis = {
        totalQuests: Number(kpiAgg?.total_quests) || 0,
        completedQuests: Number(kpiAgg?.completed_quests) || 0,
        openQuests: Number(kpiAgg?.open_quests) || 0,
        completedThisWeek: Number(kpiAgg?.completed_this_week) || 0,
        completedLastWeek: Number(kpiAgg?.completed_last_week) || 0,
        avgCycleTimeHours: Number(kpiAgg?.avg_cycle_time_hours) || 0,
        activeCharacters: Number(characterAgg?.active_characters) || 0,
      };

      // Daily created counts over the campaign's lifetime.
      const createdByDay = await this.database.run(
        sql`
					SELECT
						${createdAtDay} as date,
						COUNT(*) as count
					FROM ${this.quests.table}
					WHERE ${this.quests.table.campaignId} = ${params.id}
						AND ${this.quests.table.deletedAt} IS NULL
					GROUP BY ${createdAtDay}
				`,
        t.object({
          date: t.string(),
          count: t.string(),
        }),
      );

      // Daily completed counts over the campaign's lifetime.
      const completedByDay = await this.database.run(
        sql`
					SELECT
						${completedAtDay} as date,
						COUNT(*) as count
					FROM ${this.quests.table}
					WHERE ${this.quests.table.campaignId} = ${params.id}
						AND ${this.quests.table.deletedAt} IS NULL
						AND ${this.quests.table.completedAt} IS NOT NULL
					GROUP BY ${completedAtDay}
				`,
        t.object({
          date: t.string(),
          count: t.string(),
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
					WHERE ${this.quests.table.campaignId} = ${params.id}
						AND ${this.quests.table.deletedAt} IS NULL
				`,
        t.object({
          stale_quests: t.string(),
          unassigned_quests: t.string(),
          blocked_quests: t.string(),
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
   * Chronicles "Quests" tab: a lifecycle funnel (new → accepted → completed),
   * completed-vs-remaining breakdowns by zone and by priority, average cycle
   * time per priority, and an actionable list of the oldest still-open quests.
   *
   * Same access model as `getChroniclesOverview`: members-only + the
   * `chronicles` paywall. Date computations dialect-branch (SQLite epoch-ms
   * ints in production, Postgres timestamps in tests).
   */
  getChroniclesQuests = $action({
    use: [
      $secure({ permissions: ["stats:read"] }),
      $etag({
        control: { private: true, maxAge: 60, staleWhileRevalidate: 300 },
      }),
    ],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: chroniclesQuestsSchema,
    },
    handler: async ({ params, user }) => {
      const { campaign } = await this.security.assertMember(params.id, user);

      if (!this.paywall.isUnlocked(campaign.unlockedFeatures, "chronicles")) {
        throw new ForbiddenError(
          "Chronicles is locked — buy it from the Shop.",
        );
      }

      const isSqlite = this.database.dialect === "sqlite";
      // Cycle time = completedAt - acceptedAt expressed in hours. SQLite
      // stores epoch-ms integers (divide by 3.6M); Postgres stores
      // timestamps (EXTRACT EPOCH gives seconds, divide by 3600).
      const cycleHours = isSqlite
        ? sql`COALESCE(AVG(${this.quests.table.completedAt} - ${this.quests.table.acceptedAt}) / 3600000.0, 0)`
        : sql`COALESCE(AVG(EXTRACT(EPOCH FROM (${this.quests.table.completedAt} - ${this.quests.table.acceptedAt}))) / 3600.0, 0)`;
      const priorityOrder = sql`
				CASE ${this.quests.table.priority}
					WHEN 'high' THEN 1
					WHEN 'medium' THEN 2
					WHEN 'low' THEN 3
					WHEN 'optional' THEN 4
				END
			`;

      // Lifecycle funnel — single pass over the campaign's live quests.
      const [funnelAgg] = await this.database.run(
        sql`
					SELECT
						COUNT(CASE WHEN ${this.quests.table.acceptedAt} IS NULL AND ${this.quests.table.completedAt} IS NULL THEN 1 END) as new_count,
						COUNT(CASE WHEN ${this.quests.table.acceptedAt} IS NOT NULL AND ${this.quests.table.completedAt} IS NULL THEN 1 END) as accepted_count,
						COUNT(CASE WHEN ${this.quests.table.completedAt} IS NOT NULL THEN 1 END) as completed_count
					FROM ${this.quests.table}
					WHERE ${this.quests.table.campaignId} = ${params.id}
						AND ${this.quests.table.deletedAt} IS NULL
				`,
        t.object({
          new_count: t.string(),
          accepted_count: t.string(),
          completed_count: t.string(),
        }),
      );

      const funnel = {
        new: Number(funnelAgg?.new_count) || 0,
        accepted: Number(funnelAgg?.accepted_count) || 0,
        completed: Number(funnelAgg?.completed_count) || 0,
      };

      // Completed vs remaining per zone — top 8 busiest zones.
      const byZoneQuery = await this.database.run(
        sql`
					SELECT
						COALESCE(${this.quests.table.zone}, 'Unassigned') as zone,
						COUNT(CASE WHEN ${this.quests.table.completedAt} IS NOT NULL THEN 1 END) as completed,
						COUNT(CASE WHEN ${this.quests.table.completedAt} IS NULL THEN 1 END) as remaining
					FROM ${this.quests.table}
					WHERE ${this.quests.table.campaignId} = ${params.id}
						AND ${this.quests.table.deletedAt} IS NULL
					GROUP BY ${this.quests.table.zone}
					ORDER BY (
						COUNT(CASE WHEN ${this.quests.table.completedAt} IS NOT NULL THEN 1 END)
						+ COUNT(CASE WHEN ${this.quests.table.completedAt} IS NULL THEN 1 END)
					) DESC
					LIMIT 8
				`,
        t.object({
          zone: t.string(),
          completed: t.string(),
          remaining: t.string(),
        }),
      );

      const byZone = byZoneQuery.map((row) => ({
        zone: String(row.zone),
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
					WHERE ${this.quests.table.campaignId} = ${params.id}
						AND ${this.quests.table.deletedAt} IS NULL
					GROUP BY ${this.quests.table.priority}
					ORDER BY ${priorityOrder}
				`,
        t.object({
          priority: t.string(),
          completed: t.string(),
          remaining: t.string(),
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
					WHERE ${this.quests.table.campaignId} = ${params.id}
						AND ${this.quests.table.deletedAt} IS NULL
						AND ${this.quests.table.acceptedAt} IS NOT NULL
						AND ${this.quests.table.completedAt} IS NOT NULL
					GROUP BY ${this.quests.table.priority}
					ORDER BY ${priorityOrder}
				`,
        t.object({
          priority: t.string(),
          avg_hours: t.string(),
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
						${this.quests.table.zone} as zone,
						${this.quests.table.priority} as priority,
						${this.quests.table.acceptedAt} as accepted_at
					FROM ${this.quests.table}
					WHERE ${this.quests.table.campaignId} = ${params.id}
						AND ${this.quests.table.deletedAt} IS NULL
						AND ${this.quests.table.acceptedAt} IS NOT NULL
						AND ${this.quests.table.completedAt} IS NULL
					ORDER BY ${this.quests.table.acceptedAt} ASC
					LIMIT 10
				`,
        t.object({
          short_id: t.string(),
          title: t.string(),
          zone: t.optional(t.string()),
          priority: t.string(),
          accepted_at: t.string(),
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
          zone: row.zone ?? "Unassigned",
          priority: String(row.priority),
          ageDays: Math.floor((now - acceptedMs) / 86400000),
        };
      });

      return {
        funnel,
        byZone,
        byPriority,
        cycleTimeByPriority,
        aging,
      };
    },
  });

  /**
   * Chronicles "Party" tab: a per-character leaderboard (completed quests, XP,
   * gold), a weekly per-contributor contribution matrix for a stacked-area
   * chart, and an "idle" list of members who have not completed a quest in the
   * last 14 days.
   *
   * Same access model as `getChroniclesOverview`: members-only + the
   * `chronicles` paywall. Date computations dialect-branch (SQLite epoch-ms
   * ints in production, Postgres timestamps in tests).
   */
  getChroniclesParty = $action({
    use: [
      $secure({ permissions: ["stats:read"] }),
      $etag({
        control: { private: true, maxAge: 60, staleWhileRevalidate: 300 },
      }),
    ],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: chroniclesPartySchema,
    },
    handler: async ({ params, user }) => {
      const { campaign } = await this.security.assertMember(params.id, user);

      if (!this.paywall.isUnlocked(campaign.unlockedFeatures, "chronicles")) {
        throw new ForbiddenError(
          "Chronicles is locked — buy it from the Shop.",
        );
      }

      const isSqlite = this.database.dialect === "sqlite";
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

      // Leaderboard — one row per character in the campaign, LEFT-JOINed to
      // the per-user completed-quest count and the users table for the name.
      const leaderboardQuery = await this.database.run(
        sql`
					SELECT
						${this.characters.table.userId} as user_id,
						${userName} as name,
						${this.characters.table.picture} as picture,
						${this.characters.table.xp} as xp,
						${this.characters.table.balance} as gold,
						COALESCE(q.completed_count, 0) as quests_completed
					FROM ${this.characters.table}
					LEFT JOIN ${this.users.table}
						ON ${this.users.table.id} = ${this.characters.table.userId}
					LEFT JOIN (
						SELECT
							${this.quests.table.completedBy} as completed_by,
							COUNT(*) as completed_count
						FROM ${this.quests.table}
						WHERE ${this.quests.table.campaignId} = ${params.id}
							AND ${this.quests.table.completedAt} IS NOT NULL
							AND ${this.quests.table.deletedAt} IS NULL
						GROUP BY ${this.quests.table.completedBy}
					) q ON q.completed_by = ${this.characters.table.userId}
					WHERE ${this.characters.table.campaignId} = ${params.id}
					ORDER BY quests_completed DESC, ${this.characters.table.xp} DESC
				`,
        t.object({
          user_id: t.string(),
          name: t.optional(t.string()),
          picture: t.optional(t.string()),
          xp: t.string(),
          gold: t.string(),
          quests_completed: t.string(),
        }),
      );

      const leaderboard = leaderboardQuery.map((row) => ({
        userId: String(row.user_id),
        name: row.name ?? String(row.user_id).slice(0, 8),
        picture: row.picture ?? undefined,
        questsCompleted: Number(row.quests_completed) || 0,
        xp: Number(row.xp) || 0,
        gold: Number(row.gold) || 0,
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
      // `week` is a sortable label: SQLite `%Y-%W`, Postgres `IYYY-IW`.
      const weekBucket = isSqlite
        ? sql`strftime('%Y-%W', ${this.quests.table.completedAt} / 1000, 'unixepoch')`
        : sql`to_char(${this.quests.table.completedAt}, 'IYYY-IW')`;
      const weeksAgo = isSqlite
        ? sql.raw("(strftime('%s', 'now', '-56 days') * 1000)")
        : sql.raw("CURRENT_DATE - INTERVAL '56 days'");

      const contributionQuery = await this.database.run(
        sql`
					SELECT
						${weekBucket} as week,
						${this.quests.table.completedBy} as completed_by,
						COUNT(*) as count
					FROM ${this.quests.table}
					WHERE ${this.quests.table.campaignId} = ${params.id}
						AND ${this.quests.table.completedAt} IS NOT NULL
						AND ${this.quests.table.deletedAt} IS NULL
						AND ${this.quests.table.completedAt} >= ${weeksAgo}
					GROUP BY week, ${this.quests.table.completedBy}
				`,
        t.object({
          week: t.string(),
          completed_by: t.optional(t.string()),
          count: t.string(),
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
					WHERE ${this.quests.table.campaignId} = ${params.id}
						AND ${this.quests.table.completedAt} IS NOT NULL
						AND ${this.quests.table.deletedAt} IS NULL
					GROUP BY ${this.quests.table.completedBy}
				`,
        t.object({
          completed_by: t.optional(t.string()),
          last_completed_at: t.optional(t.string()),
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
