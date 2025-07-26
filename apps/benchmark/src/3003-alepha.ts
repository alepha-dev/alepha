import { run } from "@alepha/core";
import { $route } from "@alepha/server";

class App {
	ping = $route({
		path: "/ping",
		handler: () => "pong",
	});
}

run(App, {
	env: {
		LOG_LEVEL: "silent",
		SERVER_PORT: 3003,
	},
	ready: () => {
		console.log("Alepha server listening on :3003");
	},
});
