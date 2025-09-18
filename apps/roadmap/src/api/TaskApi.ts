import { $inject, t } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { $logger } from "@alepha/logger";
import { pageQuerySchema, pg } from "@alepha/postgres";
import { $action, BadRequestError, okSchema } from "@alepha/server";
import sanitizeHtml from "sanitize-html";
import { characters, Db, tasks } from "../providers/Db.ts";
import { Security } from "../providers/Security.ts";
import { taskCreateSchema } from "../schemas/taskCreateSchema.ts";
import { CharacterInfo } from "../services/CharacterInfo.ts";

export class TaskApi {
	log = $logger();
	db = $inject(Db);
	characterInfo = $inject(CharacterInfo);
	dt = $inject(DateTimeProvider);
	security = $inject(Security);

	createTask = $action({
		schema: {
			body: taskCreateSchema,
			response: tasks.$schema,
		},
		handler: async ({ body, user }) => {
			const { project } = await this.security.checkOwnership(
				body.projectId,
				user,
			);

			// sanitize HTML content
			body.description = sanitizeHtml(body.description);

			if (body.package && !project.packages.includes(body.package)) {
				project.packages.push(body.package);
				await this.db.projects.updateById(project.id, {
					packages: project.packages,
				});
			}

			return await this.db.tasks.create({
				...body,
				createdBy: user.id,
				history: [],
			});
		},
	});

	getTasks = $action({
		schema: {
			params: t.object({
				projectId: t.int(),
			}),
			query: t.interface([pageQuerySchema], {
				status: t.optional(t.enum(["new", "accepted", "completed"])),
				search: t.optional(t.string()),
			}),
			response: pg.page(tasks.$schema),
		},
		handler: async ({ params, query, user }) => {
			await this.security.checkOwnership(params.projectId, user);

			let where = this.db.tasks.createQueryWhere({
				projectId: { eq: params.projectId },
			});

			if (query.search) {
				where = {
					...where,
					title: { ilike: `%${query.search}%` },
				};
			}

			if (query.status === "new") {
				where = {
					...where,
					acceptedAt: { isNull: true },
					completedAt: { isNull: true },
				};
			} else if (query.status === "accepted") {
				where = {
					...where,
					acceptedAt: { isNotNull: true },
					completedAt: { isNull: true },
				};
			} else if (query.status === "completed") {
				where = {
					...where,
					completedAt: { isNotNull: true },
				};
				query.sort ??= "completedAt,desc";
			}

			query.sort ??= "updatedAt,desc";

			return this.db.tasks.paginate(query, {
				where,
			});
		},
	});

	abandonTask = $action({
		schema: {
			params: t.object({
				id: t.int(),
			}),
			response: tasks.$schema,
		},
		handler: async ({ params, user }) => {
			const task = await this.db.tasks.findOne({
				id: { eq: params.id },
				acceptedAt: { isNotNull: true },
				completedAt: { isNull: true },
			});

			await this.security.checkOwnership(task.projectId, user);

			task.acceptedAt = undefined;
			task.acceptedBy = undefined;
			task.history.push({
				at: this.dt.nowISOString(),
				by: user.id,
				action: "unassigned",
			});

			return await this.db.tasks.save(task);
		},
	});

	acceptTask = $action({
		schema: {
			params: t.object({
				id: t.int(),
			}),
			response: tasks.$schema,
		},
		handler: async ({ params, user }) => {
			const task = await this.db.tasks.findOne({
				id: { eq: params.id },
				acceptedAt: { isNull: true },
				completedAt: { isNull: true },
			});

			await this.security.checkOwnership(task.projectId, user);

			task.acceptedAt = this.dt.nowISOString();
			task.acceptedBy = user.id;
			task.history.push({
				at: this.dt.nowISOString(),
				by: user.id,
				action: "assigned",
			});

			return await this.db.tasks.save(task);
		},
	});

	completeTask = $action({
		schema: {
			params: t.object({
				id: t.int(),
			}),
			response: t.interface([tasks.$schema], {
				character: characters.$schema,
			}),
		},
		handler: async ({ params, user }) => {
			return this.db.tasks.transaction(async (tx) => {
				const task = await this.db.tasks.findOne(
					{
						id: { eq: params.id },
						completedAt: { isNull: true },
						acceptedAt: { isNotNull: true },
					},
					{ tx },
				);

				await this.security.checkOwnership(task.projectId, user);

				// Check if all objectives are completed
				if (task.objectives.length > 0) {
					const incompleteObjectives = task.objectives.filter(
						(obj) => !obj.completed,
					);
					if (incompleteObjectives.length > 0) {
						throw new BadRequestError(
							`Cannot complete task: ${incompleteObjectives.length} objective(s) remain incomplete`,
						);
					}
				}

				const character = await this.db.characters.findOne(
					{
						projectId: { eq: task.projectId },
						userId: { eq: user.id },
					},
					{ tx },
				);

				const xp = this.characterInfo.getXpFromTask(task);
				const money = this.characterInfo.getMoneyFromTask(task);

				character.xp += xp;
				character.balance += money;
				task.completedAt = this.dt.nowISOString();
				task.completedBy = user.id;

				await Promise.all([
					this.db.characters.save(character, { tx }),
					this.db.tasks.save(task, { tx }),
				]);

				return {
					...task,
					character,
				};
			});
		},
	});

	getTaskById = $action({
		schema: {
			params: t.object({
				id: t.int(),
			}),
			response: tasks.$schema,
		},
		handler: async ({ params, user }) => {
			const task = await this.db.tasks.findOne({
				id: { eq: params.id },
			});

			await this.security.checkOwnership(task.projectId, user);

			return task;
		},
	});

	updateTaskById = $action({
		schema: {
			params: t.object({
				id: t.int(),
			}),
			body: t.partial(
				t.pick(tasks.$schema, [
					"title",
					"description",
					"package",
					"complexity",
					"priority",
					"objectives",
				]),
			),
			response: tasks.$schema,
		},
		handler: async ({ params, body, user }) => {
			const task = await this.db.tasks.findOne({
				id: { eq: params.id },
				completedAt: { isNull: true },
			});

			await this.security.checkOwnership(task.projectId, user);

			// TODO: character.can("edit:task", projectId)

			if (body.description) {
				// sanitize HTML content
				body.description = sanitizeHtml(body.description);
			}

			return await this.db.tasks.updateById(params.id, {
				...body,
				history: [
					...task.history,
					{
						at: this.dt.nowISOString(),
						by: user.id,
						action: "updated",
					},
				],
			});
		},
	});

	completeObjective = $action({
		schema: {
			params: t.object({
				id: t.int(),
			}),
			body: t.object({
				index: t.int(),
			}),
			response: tasks.$schema,
		},
		handler: async ({ params, user, body }) => {
			const task = await this.db.tasks.findOne({
				id: { eq: params.id },
				completedAt: { isNull: true },
				acceptedAt: { isNotNull: true },
			});

			await this.security.checkOwnership(task.projectId, user);

			if (body.index < 0 || body.index >= task.objectives.length) {
				throw new BadRequestError("Invalid objective index");
			}

			// Mark the specific objective as completed
			task.objectives[body.index].completed =
				!task.objectives[body.index].completed;

			return await this.db.tasks.updateById(params.id, {
				objectives: task.objectives,
				history: task.objectives[body.index].completed
					? [
							...task.history,
							{
								at: this.dt.nowISOString(),
								by: user.id,
								action: "objective_completed",
							},
						]
					: task.history,
			});
		},
	});

	updateTaskObjectives = $action({
		schema: {
			params: t.object({
				id: t.int(),
			}),
			body: t.object({
				objectives: t.array(
					t.object({
						title: t.string(),
						completed: t.boolean(),
					}),
				),
			}),
			response: tasks.$schema,
		},
		handler: async ({ params, body, user }) => {
			const task = await this.db.tasks.findOne({
				id: { eq: params.id },
				completedAt: { isNull: true },
			});

			await this.security.checkOwnership(task.projectId, user);

			// TODO: character.can("edit:task", projectId)

			return await this.db.tasks.updateById(params.id, {
				objectives: body.objectives,
				history: [
					...task.history,
					{
						at: this.dt.nowISOString(),
						by: user.id,
						action: "updated",
					},
				],
			});
		},
	});

	deleteTask = $action({
		schema: {
			params: t.object({
				id: t.int(),
			}),
			response: okSchema,
		},
		handler: async ({ params, user }) => {
			const task = await this.db.tasks.findOne({
				id: { eq: params.id },
			});

			await this.security.checkOwnership(task.projectId, user);

			// TODO: character.can("delete:task", projectId)

			await this.db.tasks.deleteById(params.id);

			return { ok: true };
		},
	});
}
