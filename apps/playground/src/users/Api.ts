import { t } from "@alepha/core";
import { $action } from "@alepha/server";

class Api {
	ping = $action({
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

export default Api;
