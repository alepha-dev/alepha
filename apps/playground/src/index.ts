import { run } from "@alepha/core";
import { $action } from "@alepha/server";

class App {
	ok = $action({
		handler() {
			return "Hello, world!";
		},
	});
}

run(App, {
	env: {
		NODE_ENV: "production",
	},
});
