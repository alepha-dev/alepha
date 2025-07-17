import { $module, run } from "@alepha/core";
import { $route } from "@alepha/server";
import { ServerMetricsProvider } from "@alepha/server-metrics";

class App {
	hello = $route({
		path: "/",
		handler: () => "Hello, world!",
	});

	hello2 = $route({
		path: "/2",
		handler: () => "Hello, world2!",
	});
}

run(
	$module({
		name: "app",
		register: (alepha) => alepha.with(ServerMetricsProvider).with(App),
	}),
);
