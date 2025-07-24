import { Alepha, NotImplementedError, t } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { $batch, AlephaBatch } from "../src";

// Mock handler to track calls and received items
const createMockHandler = () => {
	return vi.fn(async (items: any[]) => {
		// Default successful handler
	});
};

describe("$batch descriptor", () => {
	let alepha: Alepha;
	let time: DateTimeProvider;

	beforeEach(() => {
		alepha = Alepha.create().with(AlephaBatch);
		time = alepha.inject(DateTimeProvider);
	});

	afterEach(async () => {
		await alepha.stop();
	});

	test("should batch items and flush when maxSize is reached", async () => {
		const mockHandler = createMockHandler();
		class TestApp {
			batcher = $batch({
				schema: t.string(),
				maxSize: 3,
				handler: mockHandler,
			});
		}

		const app = alepha.inject(TestApp);
		await alepha.start();

		app.batcher.push("A");
		app.batcher.push("B");
		expect(mockHandler).not.toHaveBeenCalled();

		app.batcher.push("C"); // This should trigger the flush

		await vi.waitFor(() => {
			expect(mockHandler).toHaveBeenCalledTimes(1);
		});
		expect(mockHandler).toHaveBeenCalledWith(["A", "B", "C"]);
	});

	test("should flush remaining items when maxDuration is reached", async () => {
		const mockHandler = createMockHandler();
		class TestApp {
			batcher = $batch({
				schema: t.string(),
				maxSize: 10,
				maxDuration: [5, "seconds"],
				handler: mockHandler,
			});
		}

		const app = alepha.inject(TestApp);
		await alepha.start();

		app.batcher.push("A");
		app.batcher.push("B");
		expect(mockHandler).not.toHaveBeenCalled();

		await time.travel([6, "seconds"]); // Exceed maxDuration

		await vi.waitFor(() => {
			expect(mockHandler).toHaveBeenCalledTimes(1);
		});
		expect(mockHandler).toHaveBeenCalledWith(["A", "B"]);
	});

	test("should handle partitioning correctly", async () => {
		const mockHandler = createMockHandler();
		class TestApp {
			batcher = $batch({
				schema: t.object({ id: t.number(), value: t.string() }),
				maxSize: 2,
				partitionBy: (item) => `partition-${item.id}`,
				handler: mockHandler,
			});
		}

		const app = alepha.inject(TestApp);
		await alepha.start();

		app.batcher.push({ id: 1, value: "A" });
		app.batcher.push({ id: 2, value: "B" });
		app.batcher.push({ id: 1, value: "C" }); // Flushes partition 1

		await vi.waitFor(
			() => {
				expect(mockHandler).toHaveBeenCalledTimes(1);
			},
			{ timeout: 1000 },
		);
		expect(mockHandler).toHaveBeenCalledWith([
			{ id: 1, value: "A" },
			{ id: 1, value: "C" },
		]);

		app.batcher.push({ id: 2, value: "D" }); // Flushes partition 2

		await vi.waitFor(
			() => {
				expect(mockHandler).toHaveBeenCalledTimes(2);
			},
			{ timeout: 2000 },
		);
		expect(mockHandler).toHaveBeenCalledWith([
			{ id: 2, value: "B" },
			{ id: 2, value: "D" },
		]);
	});

	test("should flush all pending items on application stop", async () => {
		const mockHandler = createMockHandler();
		class TestApp {
			batcher = $batch({
				schema: t.string(),
				maxSize: 10,
				handler: mockHandler,
			});
		}

		const app = alepha.inject(TestApp);
		await alepha.start();

		app.batcher.push("A");
		app.batcher.push("B");

		await alepha.stop(); // Graceful shutdown should trigger flush

		expect(mockHandler).toHaveBeenCalledTimes(1);
		expect(mockHandler).toHaveBeenCalledWith(["A", "B"]);
	});

	test("should reject push promise if handler fails after retries", async () => {
		const failingHandler = vi.fn(async (items: any[]) => {
			throw new Error("Handler failed");
		});

		class TestApp {
			batcher = $batch({
				schema: t.string(),
				maxSize: 1,
				handler: failingHandler,
				retry: { max: 2 }, // Try a total of 2 times
			});
		}

		const app = alepha.inject(TestApp);
		await alepha.start();

		const pushPromise = app.batcher.push("A");

		await expect(pushPromise).rejects.toThrow("Handler failed");

		await vi.waitFor(() => {
			expect(failingHandler).toHaveBeenCalledTimes(2);
		});
	});

	test("should resolve push promise on successful processing", async () => {
		const mockHandler = createMockHandler();
		class TestApp {
			batcher = $batch({
				schema: t.string(),
				maxSize: 1,
				handler: mockHandler,
			});
		}

		const app = alepha.inject(TestApp);
		await alepha.start();

		const pushPromise = app.batcher.push("A");

		await expect(pushPromise).resolves.toBeUndefined();
	});

	test("should respect concurrency option", async () => {
		let activeHandlers = 0;
		let maxActiveHandlers = 0;

		const slowHandler = vi.fn(async (items: any[]) => {
			activeHandlers++;
			maxActiveHandlers = Math.max(maxActiveHandlers, activeHandlers);
			await time.wait(100); // Simulate work
			activeHandlers--;
		});

		class TestApp {
			batcher = $batch({
				schema: t.string(),
				maxSize: 1,
				concurrency: 2,
				handler: slowHandler,
			});
		}

		const app = alepha.inject(TestApp);
		await alepha.start();

		// Push 4 items to trigger 4 batches
		const promises = [
			app.batcher.push("A"),
			app.batcher.push("B"),
			app.batcher.push("C"),
			app.batcher.push("D"),
		];

		await Promise.all(promises);

		expect(slowHandler).toHaveBeenCalledTimes(4);
		expect(maxActiveHandlers).toBe(2);
	});

	test("should flush manually a specific partition", async () => {
		const mockHandler = createMockHandler();
		class TestApp {
			batcher = $batch({
				schema: t.object({ id: t.number(), value: t.string() }),
				maxSize: 5,
				partitionBy: (item) => `p-${item.id}`,
				handler: mockHandler,
			});
		}

		const app = alepha.inject(TestApp);
		await alepha.start();

		app.batcher.push({ id: 1, value: "A" });
		app.batcher.push({ id: 2, value: "B" });
		app.batcher.push({ id: 1, value: "C" });

		expect(mockHandler).not.toHaveBeenCalled();

		await app.batcher.flush("p-1");

		await vi.waitFor(() => {
			expect(mockHandler).toHaveBeenCalledTimes(1);
		});
		expect(mockHandler).toHaveBeenCalledWith([
			{ id: 1, value: "A" },
			{ id: 1, value: "C" },
		]);

		// The other partition should remain
		await app.batcher.flush("p-2");

		await vi.waitFor(() => {
			expect(mockHandler).toHaveBeenCalledTimes(2);
		});
		expect(mockHandler).toHaveBeenCalledWith([{ id: 2, value: "B" }]);
	});

	test("should flush all partitions manually", async () => {
		const mockHandler = createMockHandler();
		class TestApp {
			batcher = $batch({
				schema: t.object({ id: t.number(), value: t.string() }),
				maxSize: 5,
				partitionBy: (item) => `p-${item.id}`,
				handler: mockHandler,
			});
		}

		const app = alepha.inject(TestApp);
		await alepha.start();

		app.batcher.push({ id: 1, value: "A" });
		app.batcher.push({ id: 2, value: "B" });

		await app.batcher.flush();

		await vi.waitFor(() => {
			expect(mockHandler).toHaveBeenCalledTimes(2);
		});
		expect(mockHandler).toHaveBeenCalledWith([{ id: 1, value: "A" }]);
		expect(mockHandler).toHaveBeenCalledWith([{ id: 2, value: "B" }]);
	});

	test("should validate items against schema", async () => {
		const mockHandler = createMockHandler();
		class TestApp {
			batcher = $batch({
				schema: t.number(), // Expects numbers
				maxSize: 1,
				handler: mockHandler,
			});
		}

		const app = alepha.inject(TestApp);
		await alepha.start();

		// Vitest doesn't properly catch type errors in async promises thrown by TypeBox,
		// so we test the rejection with a generic Error.
		await expect(app.batcher.push("not-a-number" as any)).rejects.toThrow();
		expect(mockHandler).not.toHaveBeenCalled();

		await expect(app.batcher.push(123)).resolves.toBeUndefined();
		await vi.waitFor(() => {
			expect(mockHandler).toHaveBeenCalledWith([123]);
		});
	});

	test("should handle empty batches gracefully", async () => {
		const mockHandler = createMockHandler();
		class TestApp {
			batcher = $batch({
				schema: t.string(),
				maxSize: 5,
				handler: mockHandler,
			});
		}

		const app = alepha.inject(TestApp);
		await alepha.start();

		await app.batcher.flush(); // Should not throw or call handler

		expect(mockHandler).not.toHaveBeenCalled();
	});

	test("should handle empty partitions gracefully", async () => {
		const mockHandler = createMockHandler();
		class TestApp {
			batcher = $batch({
				schema: t.string(),
				maxSize: 5,
				maxDuration: [1, "second"],
				partitionBy: (item) => item,
				handler: mockHandler,
			});
		}
		const app = alepha.inject(TestApp);
		await alepha.start();
		await app.batcher.push("D");
		await app.batcher.flush("D");
	});

	test("should allow to get resolved items", async () => {
		let tick = 0;

		class TestApp {
			httpBatch = $batch({
				schema: t.string(),
				maxSize: 10,
				maxDuration: [100, "milliseconds"],
				handler: async (urls) => {
					tick += 1;

					if (urls.length === 1) {
						return { [urls[0]]: `Response for ${urls[0]}` };
					}

					const response: Record<string, string> = {};
					for (const url of urls) {
						response[url] = `(batch) Response for ${url}`;
					}

					return response;
				},
			});

			async fetch(url: string) {
				const response = await this.httpBatch.push(url);
				return response[url];
			}
		}

		const app = alepha.inject(TestApp);
		await alepha.start();

		const tasks: Promise<any>[] = [];

		tasks.push(app.fetch("https://example.com/A"));
		tasks.push(app.fetch("https://example.com/B"));
		await time.wait(200); // Wait for batch to accumulate items
		tasks.push(app.fetch("https://example.com/C"));

		const result = await Promise.all(tasks);

		expect(tick).toBe(2);
		expect(result).toEqual([
			"(batch) Response for https://example.com/A",
			"(batch) Response for https://example.com/B",
			"Response for https://example.com/C",
		]);

		const response = await app.fetch("https://example.com/D");
		expect(response).toBe("Response for https://example.com/D");
	});
});
