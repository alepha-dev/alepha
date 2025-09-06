import { $inject, t } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { $logger } from "@alepha/logger";
import { pageQuerySchema, pg } from "@alepha/postgres";
import { $action } from "@alepha/server";
import sanitizeHtml from "sanitize-html";
import { taskCreateSchema } from "../schemas/taskCreateSchema.ts";
import { CharacterInfo } from "../services/CharacterInfo.ts";
import { characters, Db, tasks } from "./providers/Db.ts";

export class TaskApi {
	log = $logger();
	db = $inject(Db);
	characterInfo = $inject(CharacterInfo);
	dt = $inject(DateTimeProvider);

	createTask = $action({
		schema: {
			body: taskCreateSchema,
			response: tasks.$schema,
		},
		handler: async ({ body, user }) => {
			await this.db.characters.findOne({
				projectId: { eq: body.projectId },
				userId: { eq: user.id },
			});

			// sanitize HTML content
			body.description = sanitizeHtml(body.description);

			return await this.db.tasks.create({
				...body,
				createdBy: user.id,
			});
		},
	});

	getTasks = $action({
		schema: {
			params: t.object({
				projectId: t.int(),
			}),
			query: t.composite([
				t.object({
					status: t.optional(t.enum(["new", "accepted", "completed"])),
				}),
				pageQuerySchema,
			]),
			response: pg.page(tasks.$schema),
		},
		handler: async ({ params, query, user }) => {
			await this.db.characters.findOne({
				projectId: { eq: params.projectId },
				userId: { eq: user.id },
			});

			let where = this.db.tasks.createQueryWhere({
				projectId: { eq: params.projectId },
			});

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

			await this.db.characters.findOne({
				projectId: { eq: task.projectId },
				userId: { eq: user.id },
			});

			task.acceptedAt = this.dt.nowISOString();
			task.acceptedBy = user.id;

			return await this.db.tasks.save(task);
		},
	});

	completeTask = $action({
		schema: {
			params: t.object({
				id: t.int(),
			}),
			response: t.composite([
				tasks.$schema,
				t.object({
					character: characters.$schema,
				}),
			]),
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

			// check if the user has access to the project
			await this.db.characters.findOne({
				projectId: { eq: task.projectId },
				userId: { eq: user.id },
			});

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
				]),
			),
			response: tasks.$schema,
		},
		handler: async ({ params, body, user }) => {
			const task = await this.db.tasks.findOne({
				id: { eq: params.id },
				completedAt: { isNull: true },
			});

			// check if the user has access to the project
			await this.db.characters.findOne({
				projectId: { eq: task.projectId },
				userId: { eq: user.id },
			});

			// TODO: character.can("edit:task", projectId)

			if (body.description) {
				// sanitize HTML content
				body.description = sanitizeHtml(body.description);
			}

			return await this.db.tasks.updateById(params.id, body);
		},
	});

	deleteTask = $action({
		schema: {
			params: t.object({
				id: t.int(),
			}),
			response: t.boolean(),
		},
		handler: async ({ params, user }) => {
			const task = await this.db.tasks.findOne({
				id: { eq: params.id },
			});

			// check if the user has access to the project
			await this.db.characters.findOne({
				projectId: { eq: task.projectId },
				userId: { eq: user.id },
			});

			// TODO: character.can("delete:task", projectId)

			await this.db.tasks.deleteById(params.id);

			return true;
		},
	});
}
