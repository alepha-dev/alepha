import { $inject, t } from "alepha";
import { $repository, DatabaseProvider, sql } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { $etag } from "alepha/server/etag";
import { FileSystemProvider } from "alepha/system";
import { characters } from "../entities/characters.ts";
import { projects } from "../entities/projects.ts";
import { tasks } from "../entities/tasks.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";

export class ProjectStatsController {
  tasks = $repository(tasks);
  characters = $repository(characters);
  projects = $repository(projects);
  database = $inject(DatabaseProvider);
  security = $inject(AppSecurityProvider);
  fs = $inject(FileSystemProvider);

  getProjectStats = $action({
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
          totalTasks: t.integer(),
          completedTasks: t.integer(),
          activePlayers: t.integer(),
          totalXP: t.integer(),
          averageTaskComplexity: t.number(),
        }),
        tasksByPriority: t.array(
          t.object({
            priority: t.string(),
            count: t.integer(),
            completed: t.integer(),
          }),
        ),
        tasksByComplexity: t.array(
          t.object({
            complexity: t.integer(),
            count: t.integer(),
            averageXP: t.integer(),
          }),
        ),
        topZones: t.array(
          t.object({
            zone: t.string(),
            totalTasks: t.integer(),
          }),
        ),
        activityTimeline: t.array(
          t.object({
            date: t.string(),
            tasksCompleted: t.integer(),
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
					COUNT(CASE WHEN t.deleted_at IS NULL THEN 1 END) as total_tasks,
					COUNT(CASE WHEN t.completed_at IS NOT NULL THEN 1 END) as completed_tasks,
					COUNT(DISTINCT c.user_id) as active_players,
					COALESCE(SUM(c.xp), 0) as total_xp,
					COALESCE(AVG(CAST(t.complexity AS REAL)), 0) as average_task_complexity
				FROM ${this.tasks.table} t
				LEFT JOIN ${this.characters.table} c ON c.project_id = t.project_id
				WHERE t.project_id = ${params.id}
			`,
        t.object({
          total_tasks: t.string(),
          completed_tasks: t.string(),
          active_players: t.string(),
          total_xp: t.string(),
          average_task_complexity: t.string(),
        }),
      );

      const overviewRow = overviewQuery[0];
      const overview = {
        totalTasks: Number(overviewRow?.total_tasks) || 0,
        completedTasks: Number(overviewRow?.completed_tasks) || 0,
        activePlayers: Number(overviewRow?.active_players) || 0,
        totalXP: Number(overviewRow?.total_xp) || 0,
        averageTaskComplexity:
          Number(overviewRow?.average_task_complexity) || 0,
      };

      // Get tasks by priority
      const priorityQuery = await this.database.run(
        sql`
				SELECT
					${this.tasks.table.priority},
					COUNT(*) as count,
					COUNT(CASE WHEN ${this.tasks.table.completedAt} IS NOT NULL THEN 1 END) as completed
				FROM ${this.tasks.table}
				WHERE ${this.tasks.table.projectId} = ${params.id} AND ${this.tasks.table.deletedAt} IS NULL
				GROUP BY ${this.tasks.table.priority}
				ORDER BY
					CASE ${this.tasks.table.priority}
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

      const tasksByPriority = priorityQuery.map((row) => ({
        priority: String(row.priority),
        count: Number(row.count),
        completed: Number(row.completed),
      }));

      // Get tasks by complexity
      const complexityQuery = await this.database.run(
        sql`
				SELECT
					${this.tasks.table.complexity},
					COUNT(*) as count,
					AVG(
						CASE
							WHEN ${this.tasks.table.priority} = 'high' THEN ${this.tasks.table.complexity} * 150 + 300
							WHEN ${this.tasks.table.priority} = 'medium' THEN ${this.tasks.table.complexity} * 150 + 180
							ELSE ${this.tasks.table.complexity} * 150 + 80
						END
					) as average_xp
				FROM ${this.tasks.table}
				WHERE ${this.tasks.table.projectId} = ${params.id} AND ${this.tasks.table.deletedAt} IS NULL
				GROUP BY ${this.tasks.table.complexity}
				ORDER BY ${this.tasks.table.complexity}
			`,
        t.object({
          complexity: t.string(),
          count: t.string(),
          average_xp: t.string(),
        }),
      );

      const tasksByComplexity = complexityQuery.map((row) => ({
        complexity: Number(row.complexity),
        count: Number(row.count),
        averageXP: Math.round(Number(row.average_xp) || 0),
      }));

      // Get top 6 zones/packages
      const zonesQuery = await this.database.run(
        sql`
				SELECT
					COALESCE(${this.tasks.table.package}, 'Unassigned') as zone,
					COUNT(*) as total_tasks
				FROM ${this.tasks.table}
				WHERE ${this.tasks.table.projectId} = ${params.id} AND ${this.tasks.table.deletedAt} IS NULL
				GROUP BY ${this.tasks.table.package}
				ORDER BY total_tasks DESC
				LIMIT 6
			`,
        t.object({
          zone: t.string(),
          total_tasks: t.string(),
        }),
      );

      const topZones = zonesQuery.map((row) => ({
        zone: row.zone,
        totalTasks: Number(row.total_tasks) || 0,
      }));

      const isSqlite = this.database.dialect === "sqlite";
      const daysAgo = (days: number) =>
        isSqlite
          ? sql.raw(`(strftime('%s', 'now', '-${days} days') * 1000)`)
          : sql.raw(`CURRENT_DATE - INTERVAL '${days} days'`);
      const completedAtDate = isSqlite
        ? sql`DATE(${this.tasks.table.completedAt} / 1000, 'unixepoch')`
        : sql`DATE(${this.tasks.table.completedAt})`;

      // Get activity timeline (last 365 days with all dates for filtering on frontend)
      const timelineQuery = await this.database.run(
        sql`
				SELECT
					${completedAtDate} as date,
					COUNT(*) as tasks_completed
				FROM ${this.tasks.table}
				WHERE ${this.tasks.table.projectId} = ${params.id}
					AND ${this.tasks.table.completedAt} IS NOT NULL
					AND ${this.tasks.table.deletedAt} IS NULL
					AND ${this.tasks.table.completedAt} >= ${daysAgo(364)}
				GROUP BY ${completedAtDate}
			`,
        t.object({
          date: t.string(),
          tasks_completed: t.string(),
        }),
      );

      const completionsByDate = new Map(
        timelineQuery.map((r) => [r.date, Number(r.tasks_completed)]),
      );
      const today = new Date();
      const activityTimeline = Array.from({ length: 365 }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (364 - i));
        const key = d.toISOString().split("T")[0];
        return { date: key, tasksCompleted: completionsByDate.get(key) ?? 0 };
      });

      // Calculate completion rates
      const weeklyQuery = await this.database.run(
        sql`
				SELECT COUNT(*) as completed
				FROM ${this.tasks.table}
				WHERE ${this.tasks.table.projectId} = ${params.id}
					AND ${this.tasks.table.completedAt} IS NOT NULL
					AND ${this.tasks.table.completedAt} >= ${daysAgo(7)}
			`,
        t.object({
          completed: t.string(),
        }),
      );

      const monthlyQuery = await this.database.run(
        sql`
				SELECT COUNT(*) as completed
				FROM ${this.tasks.table}
				WHERE ${this.tasks.table.projectId} = ${params.id}
					AND ${this.tasks.table.completedAt} IS NOT NULL
					AND ${this.tasks.table.completedAt} >= ${daysAgo(30)}
			`,
        t.object({
          completed: t.string(),
        }),
      );

      const weeklyCompleted = Number(weeklyQuery[0]?.completed) || 0;
      const monthlyCompleted = Number(monthlyQuery[0]?.completed) || 0;
      const overallRate =
        overview.totalTasks > 0
          ? (overview.completedTasks / overview.totalTasks) * 100
          : 0;

      const completionRate = {
        weekly: weeklyCompleted,
        monthly: monthlyCompleted,
        overall: overallRate,
      };

      return {
        overview,
        tasksByPriority,
        tasksByComplexity,
        topZones,
        activityTimeline,
        completionRate,
      };
    },
  });

  exportTasksCsv = $action({
    use: [$secure({ permissions: ["stats:export"] })],
    path: "/projects/:id/export",
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: t.file(),
    },
    handler: async ({ params, user }) => {
      await this.security.checkOwnership(params.id, user);

      const project = await this.projects.getOne({
        where: { id: { eq: params.id } },
      });

      const projectTasks = await this.tasks.findMany({
        where: { projectId: { eq: params.id } },
        orderBy: "createdAt",
        limit: 1000,
      });

      const fields = [
        "id",
        "title",
        "package",
        "priority",
        "complexity",
        "createdAt",
        "acceptedAt",
        "completedAt",
      ];

      let csvContent = `${fields.join(",")}\n`;
      for (const task of projectTasks) {
        const row = fields.map((field) => {
          let value = (task as any)[field] ?? "";
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
        name: `tasks-export-${project.title}-${new Date().toISOString().split("T")[0]}.csv`,
        type: "text/csv",
      });
    },
  });
}
