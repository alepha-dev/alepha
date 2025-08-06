import { $inject, $logger, t } from "@alepha/core";
import { $action, NotFoundError } from "@alepha/server";
import { Db, tasks } from "../providers/Db.ts";

class TaskApi {
	log = $logger();
	db = $inject(Db);

	getTasks = $action({
		group: "read",
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
				},
			});
		},
	});

	getTaskById = $action({
		group: "read",
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
		group: "write",
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
		group: "write",
		schema: {
			body: t.omit(tasks.$insertSchema, ["createdBy"]),
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
		group: "write",
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
