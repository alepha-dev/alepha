import { $hook, run } from "@alepha/core";
import { $logger } from "@alepha/logger";

class App {
	log = $logger();

	ready = $hook({
		on: "ready",
		handler: () => {
			this.log.info("App is ready!");
		},
	});
}

run(App);
