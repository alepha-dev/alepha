import { $inject, t } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { $logger } from "@alepha/logger";
import type { UserAccountToken } from "@alepha/security";
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
			response: t.array(tasks.$schema),
		},
		handler: async ({ params, user }) => {
			await this.db.characters.findOne({
				projectId: { eq: params.projectId },
				userId: { eq: user.id },
			});

			return this.db.tasks.find({
				limit: 100,
				where: {
					projectId: { eq: params.projectId },
					completedAt: { isNull: true },
				},
			});
		},
	});

	getTasksByStatus = $action({
		schema: {
			params: t.object({
				projectId: t.int(),
			}),
			query: t.object({
				status: t.optional(t.enum(["new", "accepted", "completed"])),
			}),
			response: t.array(tasks.$schema),
		},
		handler: async ({ params, query, user }) => {
			await this.db.characters.findOne({
				projectId: { eq: params.projectId },
				userId: { eq: user.id },
			});

			let where: any = {
				projectId: { eq: params.projectId },
			};

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
			}

			return this.db.tasks.find({
				limit: 100,
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
			const { task } = await this.check(user, params.id);

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
			await this.check(user, params.id);

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
			await this.check(user, params.id);

			await this.db.tasks.deleteById(params.id);

			return true;
		},
	});

	// -------------------------------------------------------------------------------------------------------------------

	/**
	 * Act like a security check and load task + character.
	 */
	check = async (user: UserAccountToken, taskId: number) => {
		// 1. load the task
		const task = await this.db.tasks.findOne({
			id: { eq: taskId },
		});

		// 2. load the character associated to the project AND the user
		// if no match => no access
		const character = await this.db.characters.findOne({
			projectId: { eq: task.projectId },
			userId: { eq: user.id },
		});

		return { task, character };
	};
}
