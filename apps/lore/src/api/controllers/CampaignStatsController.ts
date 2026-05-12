import { $inject, t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DatabaseProvider, sql } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { $etag } from "alepha/server/etag";
import { FileSystemProvider } from "alepha/system";
import { campaigns } from "../entities/campaigns.ts";
import { characters } from "../entities/characters.ts";
import { quests } from "../entities/quests.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";

export class CampaignStatsController {
  quests = $repository(quests);
  characters = $repository(characters);
  campaigns = $repository(campaigns);
  database = $inject(DatabaseProvider);
  security = $inject(AppSecurityProvider);
  fs = $inject(FileSystemProvider);
  dt = $inject(DateTimeProvider);

  getCampaignStats = $action({
    use: [
      $secure({ permissions: ["stats:read"] }),
      $etag({
        store: true,
        control: { private: true, maxAge: 60, staleWhileRevalidate: 300 },
      }),
    ],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: t.object({
        overview: t.object({
          totalQuests: t.integer(),
          completedQuests: t.integer(),
          activeAdventurers: t.integer(),
          totalXP: t.integer(),
          averageQuestDifficulty: t.number(),
        }),
        questsByPriority: t.array(
          t.object({
            priority: t.string(),
            count: t.integer(),
            completed: t.integer(),
          }),
        ),
        questsByDifficulty: t.array(
          t.object({
            difficulty: t.integer(),
            count: t.integer(),
            averageXP: t.integer(),
          }),
        ),
        topZones: t.array(
          t.object({
            zone: t.string(),
            totalQuests: t.integer(),
          }),
        ),
        activityTimeline: t.array(
          t.object({
            date: t.string(),
            questsCompleted: t.integer(),
          }),
        ),
        completionRate: t.object({
          weekly: t.number(),
          monthly: t.number(),
          overall: t.number(),
        }),
      }),
    },
    handler: async ({ params, user }) => {
      await this.security.checkOwnership(params.id, user);

      // Get overview stats
      const overviewQuery = await this.database.run(
        sql`
				SELECT
					COUNT(CASE WHEN t.deleted_at IS NULL THEN 1 END) as total_quests,
					COUNT(CASE WHEN t.completed_at IS NOT NULL THEN 1 END) as completed_quests,
					COUNT(DISTINCT c.user_id) as active_adventurers,
					COALESCE(SUM(c.xp), 0) as total_xp,
					COALESCE(AVG(CAST(t.difficulty AS REAL)), 0) as average_quest_difficulty
				FROM ${this.quests.table} t
				LEFT JOIN ${this.characters.table} c ON c.campaign_id = t.campaign_id
				WHERE t.campaign_id = ${params.id}
			`,
        t.object({
          total_quests: t.string(),
          completed_quests: t.string(),
          active_adventurers: t.string(),
          total_xp: t.string(),
          average_quest_difficulty: t.string(),
        }),
      );

      const overviewRow = overviewQuery[0];
      const overview = {
        totalQuests: Number(overviewRow?.total_quests) || 0,
        completedQuests: Number(overviewRow?.completed_quests) || 0,
        activeAdventurers: Number(overviewRow?.active_adventurers) || 0,
        totalXP: Number(overviewRow?.total_xp) || 0,
        averageQuestDifficulty:
          Number(overviewRow?.average_quest_difficulty) || 0,
      };

      // Get quests by priority
      const priorityQuery = await this.database.run(
        sql`
				SELECT
					${this.quests.table.priority},
					COUNT(*) as count,
					COUNT(CASE WHEN ${this.quests.table.completedAt} IS NOT NULL THEN 1 END) as completed
				FROM ${this.quests.table}
				WHERE ${this.quests.table.campaignId} = ${params.id} AND ${this.quests.table.deletedAt} IS NULL
				GROUP BY ${this.quests.table.priority}
				ORDER BY
					CASE ${this.quests.table.priority}
						WHEN 'high' THEN 1
						WHEN 'medium' THEN 2
						WHEN 'low' THEN 3
						WHEN 'optional' THEN 4
					END
			`,
        t.object({
          priority: t.string(),
          count: t.string(),
          completed: t.string(),
        }),
      );

      const questsByPriority = priorityQuery.map((row) => ({
        priority: String(row.priority),
        count: Number(row.count),
        completed: Number(row.completed),
      }));

      // Get quests by difficulty
      const difficultyQuery = await this.database.run(
        sql`
				SELECT
					${this.quests.table.difficulty},
					COUNT(*) as count,
					AVG(
						CASE
							WHEN ${this.quests.table.priority} = 'high' THEN ${this.quests.table.difficulty} * 150 + 300
							WHEN ${this.quests.table.priority} = 'medium' THEN ${this.quests.table.difficulty} * 150 + 180
							ELSE ${this.quests.table.difficulty} * 150 + 80
						END
					) as average_xp
				FROM ${this.quests.table}
				WHERE ${this.quests.table.campaignId} = ${params.id} AND ${this.quests.table.deletedAt} IS NULL
				GROUP BY ${this.quests.table.difficulty}
				ORDER BY ${this.quests.table.difficulty}
			`,
        t.object({
          difficulty: t.string(),
          count: t.string(),
          average_xp: t.string(),
        }),
      );

      const questsByDifficulty = difficultyQuery.map((row) => ({
        difficulty: Number(row.difficulty),
        count: Number(row.count),
        averageXP: Math.round(Number(row.average_xp) || 0),
      }));

      // Get top 6 zones/zones
      const zonesQuery = await this.database.run(
        sql`
				SELECT
					COALESCE(${this.quests.table.zone}, 'Unassigned') as zone,
					COUNT(*) as total_quests
				FROM ${this.quests.table}
				WHERE ${this.quests.table.campaignId} = ${params.id} AND ${this.quests.table.deletedAt} IS NULL
				GROUP BY ${this.quests.table.zone}
				ORDER BY total_quests DESC
				LIMIT 6
			`,
        t.object({
          zone: t.string(),
          total_quests: t.string(),
        }),
      );

      const topZones = zonesQuery.map((row) => ({
        zone: row.zone,
        totalQuests: Number(row.total_quests) || 0,
      }));

      const isSqlite = this.database.dialect === "sqlite";
      const daysAgo = (days: number) =>
        isSqlite
          ? sql.raw(`(strftime('%s', 'now', '-${days} days') * 1000)`)
          : sql.raw(`CURRENT_DATE - INTERVAL '${days} days'`);
      const completedAtDate = isSqlite
        ? sql`DATE(${this.quests.table.completedAt} / 1000, 'unixepoch')`
        : sql`DATE(${this.quests.table.completedAt})`;

      // Get activity timeline (last 365 days with all dates for filtering on frontend)
      const timelineQuery = await this.database.run(
        sql`
				SELECT
					${completedAtDate} as date,
					COUNT(*) as quests_completed
				FROM ${this.quests.table}
				WHERE ${this.quests.table.campaignId} = ${params.id}
					AND ${this.quests.table.completedAt} IS NOT NULL
					AND ${this.quests.table.deletedAt} IS NULL
					AND ${this.quests.table.completedAt} >= ${daysAgo(364)}
				GROUP BY ${completedAtDate}
			`,
        t.object({
          date: t.string(),
          quests_completed: t.string(),
        }),
      );

      const completionsByDate = new Map(
        timelineQuery.map((r) => [r.date, Number(r.quests_completed)]),
      );
      const today = new Date(this.dt.nowMillis());
      const activityTimeline = Array.from({ length: 365 }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (364 - i));
        const key = d.toISOString().split("T")[0];
        return { date: key, questsCompleted: completionsByDate.get(key) ?? 0 };
      });

      // Calculate completion rates
      const weeklyQuery = await this.database.run(
        sql`
				SELECT COUNT(*) as completed
				FROM ${this.quests.table}
				WHERE ${this.quests.table.campaignId} = ${params.id}
					AND ${this.quests.table.completedAt} IS NOT NULL
					AND ${this.quests.table.completedAt} >= ${daysAgo(7)}
			`,
        t.object({
          completed: t.string(),
        }),
      );

      const monthlyQuery = await this.database.run(
        sql`
				SELECT COUNT(*) as completed
				FROM ${this.quests.table}
				WHERE ${this.quests.table.campaignId} = ${params.id}
					AND ${this.quests.table.completedAt} IS NOT NULL
					AND ${this.quests.table.completedAt} >= ${daysAgo(30)}
			`,
        t.object({
          completed: t.string(),
        }),
      );

      const weeklyCompleted = Number(weeklyQuery[0]?.completed) || 0;
      const monthlyCompleted = Number(monthlyQuery[0]?.completed) || 0;
      const overallRate =
        overview.totalQuests > 0
          ? (overview.completedQuests / overview.totalQuests) * 100
          : 0;

      const completionRate = {
        weekly: weeklyCompleted,
        monthly: monthlyCompleted,
        overall: overallRate,
      };

      return {
        overview,
        questsByPriority,
        questsByDifficulty,
        topZones,
        activityTimeline,
        completionRate,
      };
    },
  });

  exportQuestsCsv = $action({
    use: [$secure({ permissions: ["stats:export"] })],
    path: "/campaigns/:id/export",
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: t.file(),
    },
    handler: async ({ params, user }) => {
      await this.security.checkOwnership(params.id, user);

      const campaign = await this.campaigns.getOne({
        where: { id: { eq: params.id } },
      });

      const campaignQuests = await this.quests.findMany({
        where: { campaignId: { eq: params.id } },
        orderBy: "createdAt",
        limit: 1000,
      });

      const fields = [
        "id",
        "title",
        "zone",
        "priority",
        "difficulty",
        "createdAt",
        "acceptedAt",
        "completedAt",
      ];

      let csvContent = `${fields.join(",")}\n`;
      for (const quest of campaignQuests) {
        const row = fields.map((field) => {
          let value = (quest as any)[field] ?? "";
          if (value && typeof value === "object" && "toISOString" in value) {
            value = value.toISOString();
          } else if (typeof value === "string") {
            // Escape double quotes in strings
            value = value.replace(/"/g, '""');
            // Wrap string values in double quotes
            value = `"${value}"`;
          } else if (typeof value === "object") {
            // For objects/arrays, stringify them
            value = `"${JSON.stringify(value).replace(/"/g, '""')}"`;
          }
          return value;
        });
        csvContent += `${row.join(",")}\n`;
      }

      return this.fs.createFile({
        text: csvContent,
        name: `quests-export-${campaign.title}-${this.dt.nowISOString().split("T")[0]}.csv`,
        type: "text/csv",
      });
    },
  });
}
