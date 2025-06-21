import { run } from "@alepha/core";
import { $action } from "@alepha/server";

class App {
	ping = $action({
		handler: () => "pong",
	});
}

run(App, {
	env: {
		LOG_LEVEL: "silent",
		SERVER_PORT: 3003,
		SERVER_API_PREFIX: "",
	},
});
