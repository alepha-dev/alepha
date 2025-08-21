import { Alepha } from "@alepha/core";
import { describe, it } from "vitest";
import {
	$logger,
	LogDestinationProvider,
	MemoryDestinationProvider,
} from "../src";

describe("$logger", () => {
	class App {
		log = $logger();
	}

	it("should log in-memory", ({ expect }) => {
		const alepha = Alepha.create({
			env: {
				LOG_LEVEL: "trace",
			},
		}).with({
			provide: LogDestinationProvider,
			use: MemoryDestinationProvider,
		});
		const output = alepha.inject(MemoryDestinationProvider);
		const app = alepha.inject(App);

		app.log.info("Test log message");

		expect(output.logs[0].message).toBe("Test log message");
		expect(output.logs[0].level).toBe("info");
		expect(output.logs[0].service).toBe("App");
		expect(output.logs[0].module).toBe("app");
		expect(output.logs[0].app).toBeUndefined();
		expect(output.logs[0].context).toBeUndefined();
		expect(output.logs[0].timestamp).toBeDefined();

		app.log.trace("Trace log message");
		expect(output.logs[1].message).toBe("Trace log message");
		app.log.warn("Warning log message");
		expect(output.logs[2].message).toBe("Warning log message");
		app.log.error("Error log message");
		expect(output.logs[3].message).toBe("Error log message");
		app.log.debug("Debug log message");
		expect(output.logs[4].message).toBe("Debug log message");
	});

	it("should log with Alepha", async ({ expect }) => {
		const alepha = Alepha.create({
			env: {
				LOG_LEVEL: "info",
			},
		}).with({
			provide: LogDestinationProvider,
			use: MemoryDestinationProvider,
		});
		const output = alepha.inject(MemoryDestinationProvider);
		const app = alepha.inject(App);
		await alepha.start();
		app.log.info("Test log message");
		expect(output.logs.length).toBe(3);
	});

	it("should skip alepha logs", async ({ expect }) => {
		const alepha = Alepha.create({
			env: {
				LOG_LEVEL: "alepha.core:error,info",
			},
		}).with({
			provide: LogDestinationProvider,
			use: MemoryDestinationProvider,
		});
		const output = alepha.inject(MemoryDestinationProvider);
		const app = alepha.inject(App);
		await alepha.start();
		app.log.info("Test log message");
		expect(output.logs.length).toBe(1);
	});
});
