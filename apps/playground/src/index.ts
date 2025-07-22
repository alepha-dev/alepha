import { Alepha, run } from "@alepha/core";
import { $thread } from "@alepha/thread";

const app = Alepha.create();

const task = app.use($thread, {
	name: "longTask",
	handler: async () => {
		app.log.info("Long task started");
		// Simulate a long-running task
		app.log.info("Long task completed");
	},
});

app.on("ready", async () => {
	if (app.isWorkerThread()) {
		return;
	}

	app.log.info("App is ready, starting long task...");
	await task.create();
	app.log.info("Long task has been initiated.");
});

run(app);
