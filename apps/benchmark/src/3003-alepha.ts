import { Alepha, run } from "@alepha/core";
import { $route } from "@alepha/server";

class App {
	ping = $route({
		path: "/ping",
		handler: () => "pong",
	});
}

const alepha = Alepha.create({
	env: {
		NODE_ENV: "production",
		LOG_LEVEL: "silent",
		SERVER_PORT: 3003,
	},
});

alepha.with(App);

run(alepha, {
	ready: () => {
		console.log("Alepha server listening on :3003");
	},
});
