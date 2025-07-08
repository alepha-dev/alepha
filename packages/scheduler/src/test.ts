import { $hook, $inject, $logger, Alepha, run } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { $scheduler } from "./descriptors/$scheduler.ts";
import { AlephaScheduler } from "./index.ts";

class App {
	dt = $inject(DateTimeProvider);
	alepha = $inject(Alepha);
	log = $logger();

	t = $scheduler({
		interval: [1, "hour"],
		handler: async ({ now }) => {
			this.log.info("Hello World from descriptor");
			this.log.info(`Current time: ${now.format("HH:mm:ss")}`);
		},
	});

	hi = $scheduler({
		cron: "* * * * *",
		handler: async ({ now }) => {
			this.log.info("Hello World from descriptor");
			this.log.info(`Current time: ${now.format("HH:mm:ss")}`);
		},
	});

	start = $hook({
		on: "ready",
		handler: async () => {
			console.log("BEGIN", this.dt.now().format("HH:mm:ss"));

			this.dt //
				.wait(60000)
				.then(async () => {
					await this.alepha.stop();
					console.log("END", this.dt.now().format("HH:mm:ss"));
				});
		},
	});
}

run([App, AlephaScheduler], {
	env: {
		LOG_LEVEL: "trace",
	},
});
