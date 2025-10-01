import { Alepha } from "@alepha/core";
import { describe, expect, it } from "vitest";
import { AlephaDevtools, DevCollectorProvider } from "../src/index.ts";

describe("DevCollectorProvider", () => {
	it("should collect logs", async () => {
		const app = Alepha.create().with(AlephaDevtools);
		const devtools = app.inject(DevCollectorProvider);
		await app.start();

		// Clear any startup logs
		const initialLogCount = devtools.getLogs().length;

		// Emit some log events
		await app.events.emit("log", {
			message: "Test log message",
			entry: {
				level: "info",
				message: "Test log",
				service: "TestService",
				module: "test.module",
				timestamp: new Date(),
			},
		});

		const logs = devtools.getLogs();
		expect(logs).toHaveLength(initialLogCount + 1);
		const lastLog = logs[logs.length - 1];
		expect(lastLog.formatted).toBe("Test log message");
		expect(lastLog.entry.level).toBe("info");
		expect(lastLog.entry.message).toBe("Test log");
	});

	it("should limit logs to 1000 entries", async () => {
		const app = Alepha.create().with(AlephaDevtools);
		const devtools = app.inject(DevCollectorProvider);
		await app.start();

		// Emit 1500 log events
		for (let i = 0; i < 1500; i++) {
			await app.events.emit("log", {
				message: `Log ${i}`,
				entry: {
					level: "info",
					message: `Message ${i}`,
					service: "TestService",
					module: "test.module",
					timestamp: new Date(),
				},
			});
		}

		const logs = devtools.getLogs();
		expect(logs).toHaveLength(1000);
		// Should have the last 1000 logs (500-1499)
		expect(logs[0].entry.message).toBe("Message 500");
		expect(logs[999].entry.message).toBe("Message 1499");
	});

	it("should collect actions metadata", async () => {
		const app = Alepha.create().with(AlephaDevtools);
		await app.start();

		const devtools = app.inject(DevCollectorProvider);
		const actions = devtools.getActions();

		// Actions should be an array (may be empty if no server module loaded)
		expect(Array.isArray(actions)).toBe(true);
	});

	it("should collect queues metadata", async () => {
		const app = Alepha.create().with(AlephaDevtools);
		const devtools = app.inject(DevCollectorProvider);
		await app.start();

		const queues = devtools.getQueues();

		expect(Array.isArray(queues)).toBe(true);
	});

	it("should collect schedulers metadata", async () => {
		const app = Alepha.create().with(AlephaDevtools);
		const devtools = app.inject(DevCollectorProvider);
		await app.start();

		const schedulers = devtools.getSchedulers();

		expect(Array.isArray(schedulers)).toBe(true);
	});

	it("should collect topics metadata", async () => {
		const app = Alepha.create().with(AlephaDevtools);
		const devtools = app.inject(DevCollectorProvider);
		await app.start();

		const topics = devtools.getTopics();

		expect(Array.isArray(topics)).toBe(true);
	});

	it("should collect buckets metadata", async () => {
		const app = Alepha.create().with(AlephaDevtools);
		const devtools = app.inject(DevCollectorProvider);
		await app.start();

		const buckets = devtools.getBuckets();

		expect(Array.isArray(buckets)).toBe(true);
	});

	it("should collect realms metadata", async () => {
		const app = Alepha.create().with(AlephaDevtools);
		const devtools = app.inject(DevCollectorProvider);
		await app.start();

		const realms = devtools.getRealms();

		expect(Array.isArray(realms)).toBe(true);
	});

	it("should collect caches metadata", async () => {
		const app = Alepha.create().with(AlephaDevtools);
		const devtools = app.inject(DevCollectorProvider);
		await app.start();

		const caches = devtools.getCaches();

		expect(Array.isArray(caches)).toBe(true);
	});

	it("should collect pages metadata", async () => {
		const app = Alepha.create().with(AlephaDevtools);
		const devtools = app.inject(DevCollectorProvider);
		await app.start();

		const pages = devtools.getPages();

		expect(Array.isArray(pages)).toBe(true);
	});

	it("should return complete metadata object", async () => {
		const app = Alepha.create().with(AlephaDevtools);
		const devtools = app.inject(DevCollectorProvider);
		await app.start();
		const metadata = devtools.getMetadata();

		expect(metadata).toHaveProperty("logs");
		expect(metadata).toHaveProperty("actions");
		expect(metadata).toHaveProperty("queues");
		expect(metadata).toHaveProperty("schedulers");
		expect(metadata).toHaveProperty("topics");
		expect(metadata).toHaveProperty("buckets");
		expect(metadata).toHaveProperty("realms");
		expect(metadata).toHaveProperty("caches");
		expect(metadata).toHaveProperty("pages");

		expect(Array.isArray(metadata.logs)).toBe(true);
		expect(Array.isArray(metadata.actions)).toBe(true);
		expect(Array.isArray(metadata.queues)).toBe(true);
		expect(Array.isArray(metadata.schedulers)).toBe(true);
		expect(Array.isArray(metadata.topics)).toBe(true);
		expect(Array.isArray(metadata.buckets)).toBe(true);
		expect(Array.isArray(metadata.realms)).toBe(true);
		expect(Array.isArray(metadata.caches)).toBe(true);
		expect(Array.isArray(metadata.pages)).toBe(true);
	});
});
