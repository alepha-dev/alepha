import { $batch } from "@alepha/batch";
import { $hook, run, t } from "@alepha/core";

class LoggingService {
	// define the batch processor
	logBatch = $batch({
		schema: t.string(),
		maxSize: 10,
		maxDuration: [5, "seconds"],
		handler: async (items) => {
			console.log(`[BATCH LOG] Processing ${items.length} events:`, items);
		},
	});

	// example of how to use it
	onReady = $hook({
		on: "ready",
		handler: async () => {
			this.logBatch.push("Application started.");
			this.logBatch.push("User authenticated.");
			// ... more events pushed from elsewhere in the app
		},
	});
}

run(LoggingService);
