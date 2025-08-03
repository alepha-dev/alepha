import { t } from "@alepha/core";
import { $action } from "@alepha/server";

class TaskApi {
	ping = $action({
		description: "Ping the task API",
		schema: {
			response: t.object({
				message: t.string(),
			}),
		},
		handler: async () => {
			return { message: "pong" };
		},
	});
}

export default TaskApi;
