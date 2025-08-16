import { $inject, $logger, t } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import type { UserAccountToken } from "@alepha/security";
import { $action } from "@alepha/server";
import sanitizeHtml from "sanitize-html";
import { taskCreateSchema } from "../schemas/taskCreateSchema.ts";
import { Level } from "../services/Level.ts";
import { characters, Db, tasks } from "./providers/Db.ts";

class TaskApi {
	log = $logger();
	db = $inject(Db);
	lvl = $inject(Level);
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

				const xp = this.lvl.getXpFromTask(task);

				character.xp += xp;
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

	load = async (user: UserAccountToken, taskId: number) => {
		const task = await this.db.tasks.findOne({
			id: { eq: taskId },
		});
		const character = await this.db.characters.findOne({
			projectId: { eq: task.projectId },
			userId: { eq: user.id },
		});
		return { task, character };
	};

	getTaskById = $action({
		schema: {
			params: t.object({
				id: t.int(),
			}),
			response: tasks.$schema,
		},
		handler: async ({ params, user }) => {
			const { task } = await this.load(user, params.id);

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
			await this.load(user, params.id);

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
			await this.load(user, params.id);

			await this.db.tasks.deleteById(params.id);

			return true;
		},
	});
}

export default TaskApi;
