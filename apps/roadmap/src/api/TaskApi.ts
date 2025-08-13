import { $inject, $logger, t } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { $action, NotFoundError } from "@alepha/server";
import { characters, Db, tasks } from "../providers/Db.ts";
import { taskCreateSchema } from "../schemas/taskCreateSchema.ts";
import { Level } from "../services/Level.ts";

class TaskApi {
	log = $logger();
	db = $inject(Db);
	lvl = $inject(Level);
	dt = $inject(DateTimeProvider);

	getTasks = $action({
		schema: {
			params: t.object({
				projectId: t.int(),
			}),
			response: t.array(tasks.$schema),
		},
		handler: async ({ params }) => {
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

	getTaskById = $action({
		schema: {
			params: t.object({
				id: t.int(),
			}),
			response: tasks.$schema,
		},
		handler: async ({ params }) => {
			const task = await this.db.tasks.findOne({
				id: { eq: params.id },
			});

			if (!task) {
				throw new NotFoundError(`Task with id ${params.id} not found`);
			}
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
		handler: async ({ params, body }) => {
			return await this.db.tasks.updateById(params.id, body);
		},
	});

	createTask = $action({
		schema: {
			body: taskCreateSchema,
			response: tasks.$schema,
		},
		handler: async ({ body, user }) => {
			return await this.db.tasks.create({
				...body,
				createdBy: user.id,
			});
		},
	});

	deleteTask = $action({
		schema: {
			params: t.object({
				id: t.int(),
			}),
			response: t.boolean(),
		},
		handler: async ({ params }) => {
			await this.db.tasks.deleteById(params.id);
			return true;
		},
	});
}

export default TaskApi;
