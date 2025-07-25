import { $logger, Alepha, run } from "@alepha/core";
import { $thread } from "@alepha/thread";

const alepha = Alepha.create();

class TestApp {
	log = $logger();
	longTask = $thread({
		handler: async () => {
			this.log.info("Long task started");
			// Simulate a long-running task
			this.log.info("Long task completed");
		},
	});
}

const app = alepha.inject(TestApp);

alepha.on("ready", async () => {
	if (alepha.isWorkerThread()) {
		return;
	}

	alepha.log.info("App is ready, starting long task...");
	await app.longTask.create();
	alepha.log.info("Long task has been initiated.");
});

run(alepha);
