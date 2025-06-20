import { run, t } from "@alepha/core";
import { $action } from "@alepha/server";

class HelloController {
	hello = $action({
		schema: {
			response: t.object({
				message: t.string(),
			}),
		},
		handler: async () => {
			return { message: "Hello, world!" };
		},
	});
}

run(HelloController);
