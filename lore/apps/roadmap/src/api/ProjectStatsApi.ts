import { $inject, t } from "@alepha/core";
import { createFile } from "@alepha/file";
import { sql } from "@alepha/postgres";
import { $action, ForbiddenError } from "@alepha/server";
import { Db, tasks } from "../providers/Db.ts";

export class ProjectStatsApi {
	db = $inject(Db);

	getProjectStats = $action({
		cache: true,
		schema: {
			params: t.object({
				id: t.int(),
			}),
			response: t.object({
				overview: t.object({
					totalTasks: t.int(),
					completedTasks: t.int(),
					activePlayers: t.int(),
					totalXP: t.int(),
					averageTaskComplexity: t.number(),
				}),
				tasksByPriority: t.array(
					t.object({
						priority: t.string(),
						count: t.int(),
						completed: t.int(),
					}),
				),
				tasksByComplexity: t.array(
					t.object({
						complexity: t.int(),
						count: t.int(),
						averageXP: t.int(),
					}),
				),
				playerProgress: t.array(
					t.object({
						playerName: t.string(),
						level: t.int(),
						xp: t.int(),
						tasksCompleted: t.int(),
						isOwner: t.boolean(),
					}),
				),
				activityTimeline: t.array(
					t.object({
						date: t.string(),
						tasksCompleted: t.int(),
						xpGained: t.int(),
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
			// Verify project access
			const project = await this.db.projects.findOne({
				id: { eq: params.id },
			});

			if (project.createdBy !== user.id && user.ownership && !project.public) {
				throw new ForbiddenError(
					`You do not have permission to access project stats for project with id ${params.id}`,
				);
			}

			// Get overview stats
			const overviewQuery = await this.db.query(sql`
				SELECT
					COUNT(CASE WHEN t.deleted_at IS NULL THEN 1 END) as total_tasks,
					COUNT(CASE WHEN t.completed_at IS NOT NULL THEN 1 END) as completed_tasks,
					COUNT(DISTINCT c.user_id) as active_players,
					COALESCE(SUM(c.xp), 0) as total_xp,
					COALESCE(AVG(t.complexity::numeric), 0) as average_task_complexity
				FROM ${tasks} t
				LEFT JOIN ${this.db.characters.table} c ON c.project_id = t.project_id
				WHERE t.project_id = ${params.id}
			`);

			const overview = {
				totalTasks: Number(overviewQuery[0].total_tasks) || 0,
				completedTasks: Number(overviewQuery[0].completed_tasks) || 0,
				activePlayers: Number(overviewQuery[0].active_players) || 0,
				totalXP: Number(overviewQuery[0].total_xp) || 0,
				averageTaskComplexity:
					Number(overviewQuery[0].average_task_complexity) || 0,
			};

			// Get tasks by priority
			const priorityQuery = await this.db.query(sql`
				SELECT
					${tasks.priority},
					COUNT(*) as count,
					COUNT(CASE WHEN ${tasks.completedAt} IS NOT NULL THEN 1 END) as completed
				FROM ${tasks}
				WHERE ${tasks.projectId} = ${params.id} AND ${tasks.deletedAt} IS NULL
				GROUP BY ${tasks.priority}
				ORDER BY
					CASE ${tasks.priority}
						WHEN 'high' THEN 1
						WHEN 'medium' THEN 2
						WHEN 'low' THEN 3
						WHEN 'optional' THEN 4
					END
			`);

			const tasksByPriority = priorityQuery.map((row) => ({
				priority: row.priority,
				count: Number(row.count),
				completed: Number(row.completed),
			}));

			// Get tasks by complexity
			const complexityQuery = await this.db.query(sql`
				SELECT
					${tasks.complexity},
					COUNT(*) as count,
					AVG(
						CASE
							WHEN ${tasks.priority} = 'high' THEN ${tasks.complexity} * 150 + 300
							WHEN ${tasks.priority} = 'medium' THEN ${tasks.complexity} * 150 + 180
							ELSE ${tasks.complexity} * 150 + 80
						END
					) as average_xp
				FROM ${tasks}
				WHERE ${tasks.projectId} = ${params.id} AND ${tasks.deletedAt} IS NULL
				GROUP BY ${tasks.complexity}
				ORDER BY ${tasks.complexity}
			`);

			const tasksByComplexity = complexityQuery.map((row) => ({
				complexity: Number(row.complexity),
				count: Number(row.count),
				averageXP: Math.round(Number(row.average_xp) || 0),
			}));

			// Get player progress
			const playerQuery = await this.db.query(sql`
				SELECT
					u.name as player_name,
					c.xp,
					c.owner as is_owner,
					COUNT(t.id) as tasks_completed
				FROM ${this.db.characters.table} c
				JOIN ${this.db.users.table} u ON u.id = c.user_id
				LEFT JOIN ${tasks} t ON t.completed_by = c.user_id
					AND t.project_id = c.project_id
					AND t.completed_at IS NOT NULL
				WHERE c.project_id = ${params.id}
				GROUP BY c.id, u.name, c.xp, c.owner
				ORDER BY c.owner DESC, c.xp DESC
			`);

			const playerProgress = playerQuery.map((row) => {
				const xp = Number(row.xp) || 0;
				// Calculate level using the same logic as CharacterInfo
				let level = 1;
				const levels = [
					1080, 2200, 4800, 8400, 13000, 19000, 27000, 37000, 49000, 63000,
					79000, 97000, 117000, 139000, 163000, 189000, 217000, 247000,
				];
				let acc = 0;
				for (let i = 0; i < levels.length; i++) {
					acc += levels[i];
					if (xp < acc) {
						level = i + 1;
						break;
					}
				}
				if (xp >= acc) level = levels.length;

				return {
					playerName: row.player_name || "Anonymous User",
					level,
					xp,
					tasksCompleted: Number(row.tasks_completed) || 0,
					isOwner: Boolean(row.is_owner),
				};
			});

			// Get activity timeline (last 30 days)
			const timelineQuery = await this.db.query(sql`
				SELECT
					DATE(${tasks.completedAt}) as date,
					COUNT(*) as tasks_completed,
					SUM(
						CASE
							WHEN ${tasks.priority} = 'high' THEN ${tasks.complexity} * 150 + 300
							WHEN ${tasks.priority} = 'medium' THEN ${tasks.complexity} * 150 + 180
							ELSE ${tasks.complexity} * 150 + 80
						END
					) as xp_gained
				FROM ${tasks}
				WHERE ${tasks.projectId} = ${params.id}
					AND ${tasks.completedAt} IS NOT NULL
					AND ${tasks.completedAt} >= CURRENT_DATE - INTERVAL '30 days'
				GROUP BY DATE(${tasks.completedAt})
				ORDER BY date DESC
				LIMIT 30
			`);

			const activityTimeline = timelineQuery.map((row) => ({
				date: row.date,
				tasksCompleted: Number(row.tasks_completed),
				xpGained: Number(row.xp_gained) || 0,
			}));

			// Calculate completion rates
			const weeklyQuery = await this.db.query(sql`
				SELECT COUNT(*) as completed
				FROM ${tasks}
				WHERE ${tasks.projectId} = ${params.id}
					AND ${tasks.completedAt} IS NOT NULL
					AND ${tasks.completedAt} >= CURRENT_DATE - INTERVAL '7 days'
			`);

			const monthlyQuery = await this.db.query(sql`
				SELECT COUNT(*) as completed
				FROM ${tasks}
				WHERE ${tasks.projectId} = ${params.id}
					AND ${tasks.completedAt} IS NOT NULL
					AND ${tasks.completedAt} >= CURRENT_DATE - INTERVAL '30 days'
			`);

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
				playerProgress,
				activityTimeline,
				completionRate,
			};
		},
	});

	exportTasksCsv = $action({
		path: "/projects/:id/export",
		schema: {
			params: t.object({
				id: t.int(),
			}),
			response: t.file(),
		},
		handler: async ({ params, user }) => {
			// Verify project access
			const project = await this.db.projects.findOne({
				id: { eq: params.id },
			});

			await this.db.characters.findOne({
				userId: user.id,
				projectId: project.id,
			});

			const tasks = await this.db.tasks.find({
				where: { projectId: { eq: params.id } },
				sort: { createdAt: "desc" },
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
			for (const task of tasks) {
				const row = fields.map((field) => {
					let value = (task as any)[field] ?? "";
					if (value instanceof Date) {
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

			return createFile(csvContent, {
				name: `tasks-export-${project.title}-${new Date().toISOString().split("T")[0]}.csv`,
				type: "text/csv",
			});
		},
	});
}
