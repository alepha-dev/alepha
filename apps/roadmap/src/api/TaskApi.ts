import { $inject, $logger, t } from "@alepha/core";
import { $action } from "@alepha/server";
import { Db, tasks } from "../providers/Db.ts";

class TaskApi {
	log = $logger();
	db = $inject(Db);

	getTasks = $action({
		group: "read",
		schema: {
			response: t.array(tasks.$schema),
		},
		handler: async () => {
			return this.db.tasks.find();
		},
	});

	createTask = $action({
		group: "write",
		schema: {
			body: tasks.$insertSchema,
			response: tasks.$schema,
		},
		handler: async ({ body }) => {
			return await this.db.tasks.create(body);
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
