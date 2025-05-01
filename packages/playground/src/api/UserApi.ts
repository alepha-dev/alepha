import { t } from "@alepha/core";
import { $route } from "@alepha/server";

export class UserApi {
	findUsers = $route({
		schema: {
			response: t.array(
				t.object({
					id: t.string(),
					name: t.string(),
				}),
			),
		},
		handler: () => {
			return [];
		},
	});
}
