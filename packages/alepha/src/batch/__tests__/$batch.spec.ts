import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { $batch, AlephaBatch } from "../index.ts";

// Mock handler to track calls and received items
const createMockHandler = () => {
  return vi.fn(async (items: any[]) => {
    // Default successful handler
  });
};

describe("$batch primitive", () => {
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
        schema: z.text(),
        maxSize: 3,
        handler: mockHandler,
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    const id1 = await app.batcher.push("A");
    const id2 = await app.batcher.push("B");
    expect(mockHandler).not.toHaveBeenCalled();

    const id3 = await app.batcher.push("C"); // This should trigger the flush

    await vi.waitFor(() => {
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });
    expect(mockHandler).toHaveBeenCalledWith(["A", "B", "C"]);

    // Verify IDs are returned
    expect(typeof id1).toBe("string");
    expect(typeof id2).toBe("string");
    expect(typeof id3).toBe("string");
  });

  test("should flush remaining items when maxDuration is reached", async () => {
    const mockHandler = createMockHandler();
    class TestApp {
      batcher = $batch({
        schema: z.text(),
        maxSize: 10,
        maxDuration: [5, "seconds"],
        handler: mockHandler,
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    await app.batcher.push("A");
    await app.batcher.push("B");
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
        schema: z.object({ id: z.number(), value: z.text() }),
        maxSize: 2,
        partitionBy: (item) => `partition-${item.id}`,
        handler: mockHandler,
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    await app.batcher.push({ id: 1, value: "A" });
    await app.batcher.push({ id: 2, value: "B" });
    await app.batcher.push({ id: 1, value: "C" }); // Flushes partition 1

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

    await app.batcher.push({ id: 2, value: "D" }); // Flushes partition 2

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
        schema: z.text(),
        maxSize: 10,
        handler: mockHandler,
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    await app.batcher.push("A");
    await app.batcher.push("B");

    await alepha.stop(); // Graceful shutdown should trigger flush

    expect(mockHandler).toHaveBeenCalledTimes(1);
    expect(mockHandler).toHaveBeenCalledWith(["A", "B"]);
  });

  test("should reject wait promise if handler fails after retries", async () => {
    const failingHandler = vi.fn(async (items: any[]) => {
      throw new Error("Handler failed");
    });

    class TestApp {
      batcher = $batch({
        schema: z.text(),
        maxSize: 1,
        handler: failingHandler,
        retry: { max: 2 }, // Try a total of 2 times
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    const id = await app.batcher.push("A");
    expect(typeof id).toBe("string");

    const waitPromise = app.batcher.wait(id);
    await expect(waitPromise).rejects.toThrow("Handler failed");

    await vi.waitFor(() => {
      expect(failingHandler).toHaveBeenCalledTimes(2);
    });

    // Verify status is failed
    const status = app.batcher.status(id);
    expect(status?.status).toBe("failed");
    if (status?.status === "failed") {
      expect(status.error.message).toBe("Handler failed");
    }
  });

  test("should resolve wait promise on successful processing", async () => {
    const mockHandler = vi.fn(async (items: any[]) => {
      return "success";
    });
    class TestApp {
      batcher = $batch({
        schema: z.text(),
        maxSize: 1,
        handler: mockHandler,
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    const id = await app.batcher.push("A");
    expect(typeof id).toBe("string");

    // Status should be pending or processing
    let status = app.batcher.status(id);
    expect(status?.status).toMatch(/pending|processing/);

    const result = await app.batcher.wait(id);
    expect(result).toBe("success");

    // Status should now be completed
    status = app.batcher.status(id);
    expect(status?.status).toBe("completed");
    if (status?.status === "completed") {
      expect(status.result).toBe("success");
    }
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
        schema: z.text(),
        maxSize: 1,
        concurrency: 2,
        handler: slowHandler,
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    // Push 4 items to trigger 4 batches
    const ids = await Promise.all([
      app.batcher.push("A"),
      app.batcher.push("B"),
      app.batcher.push("C"),
      app.batcher.push("D"),
    ]);

    // Wait for all to complete
    await Promise.all(ids.map((id) => app.batcher.wait(id)));

    expect(slowHandler).toHaveBeenCalledTimes(4);
    expect(maxActiveHandlers).toBe(2);
  });

  test("should flush manually a specific partition", async () => {
    const mockHandler = createMockHandler();
    class TestApp {
      batcher = $batch({
        schema: z.object({ id: z.number(), value: z.text() }),
        maxSize: 5,
        partitionBy: (item) => `p-${item.id}`,
        handler: mockHandler,
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    await app.batcher.push({ id: 1, value: "A" });
    await app.batcher.push({ id: 2, value: "B" });
    await app.batcher.push({ id: 1, value: "C" });

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
        schema: z.object({ id: z.number(), value: z.text() }),
        maxSize: 5,
        partitionBy: (item) => `p-${item.id}`,
        handler: mockHandler,
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    await app.batcher.push({ id: 1, value: "A" });
    await app.batcher.push({ id: 2, value: "B" });

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
        schema: z.number(), // Expects numbers
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

    const id = await app.batcher.push(123);
    expect(typeof id).toBe("string");
    await vi.waitFor(() => {
      expect(mockHandler).toHaveBeenCalledWith([123]);
    });
  });

  test("should handle empty batches gracefully", async () => {
    const mockHandler = createMockHandler();
    class TestApp {
      batcher = $batch({
        schema: z.text(),
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
        schema: z.text(),
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
        schema: z.text(),
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
        const id = await this.httpBatch.push(url);
        const response = await this.httpBatch.wait(id);
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

  test("should handle items arriving during batch processing (race condition fix)", async () => {
    let handlerCallCount = 0;
    const handlerCalls: string[][] = [];

    class TestApp {
      batcher = $batch({
        schema: z.text(),
        maxSize: 2,
        maxDuration: [10, "seconds"],
        handler: async (items: string[]) => {
          handlerCallCount++;
          handlerCalls.push([...items]);
          // Simulate slow processing
          await time.wait(100);
          return `batch-${handlerCallCount}`;
        },
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    // Push 2 items to trigger first batch
    const id1 = await app.batcher.push("A");
    const id2 = await app.batcher.push("B");

    // Wait a bit for processing to start but not complete
    await time.wait(50);

    // Push more items while first batch is processing
    const id3 = await app.batcher.push("C");
    const id4 = await app.batcher.push("D");

    // Wait for all items to complete
    const results = await Promise.all([
      app.batcher.wait(id1),
      app.batcher.wait(id2),
      app.batcher.wait(id3),
      app.batcher.wait(id4),
    ]);

    // Should have 2 batches
    expect(handlerCallCount).toBe(2);
    expect(handlerCalls[0]).toEqual(["A", "B"]);
    expect(handlerCalls[1]).toEqual(["C", "D"]);
    expect(results).toEqual(["batch-1", "batch-1", "batch-2", "batch-2"]);
  });

  test("should handle concurrent pushes to same partition during flush", async () => {
    let processingBatch1 = false;

    class TestApp {
      batcher = $batch({
        schema: z.object({ id: z.number(), value: z.text() }),
        maxSize: 2,
        partitionBy: (item) => `p-${item.id}`,
        handler: async (items) => {
          if (!processingBatch1) {
            processingBatch1 = true;
            // Simulate slow processing for first batch only
            await time.wait(100);
          }
          return items.map((item) => ({ ...item, processed: true }));
        },
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    // Push 2 items to partition p-1 to trigger flush
    const id1 = await app.batcher.push({ id: 1, value: "A" });
    const id2 = await app.batcher.push({ id: 1, value: "B" });

    // Wait for processing to start
    await time.wait(50);

    // Push more items to same partition while processing
    const id3 = await app.batcher.push({ id: 1, value: "C" });
    const id4 = await app.batcher.push({ id: 1, value: "D" });

    await Promise.all([
      app.batcher.wait(id1),
      app.batcher.wait(id2),
      app.batcher.wait(id3),
      app.batcher.wait(id4),
    ]);

    // All items should be processed successfully
    expect(true).toBe(true); // If we got here without errors, test passes
  });

  test("should use default values for maxSize, concurrency, and maxDuration", async () => {
    const mockHandler = createMockHandler();

    class TestApp {
      batcher = $batch({
        schema: z.text(),
        // Not providing maxSize, concurrency, or maxDuration
        handler: mockHandler,
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    // Test default maxSize (10)
    for (let i = 0; i < 9; i++) {
      await app.batcher.push(`item-${i}`);
    }
    expect(mockHandler).not.toHaveBeenCalled();

    await app.batcher.push("item-9"); // 10th item should trigger flush

    await vi.waitFor(() => {
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });
    expect(mockHandler).toHaveBeenCalledWith([
      "item-0",
      "item-1",
      "item-2",
      "item-3",
      "item-4",
      "item-5",
      "item-6",
      "item-7",
      "item-8",
      "item-9",
    ]);
  });

  test("should use default maxDuration (1 second)", async () => {
    const mockHandler = createMockHandler();

    class TestApp {
      batcher = $batch({
        schema: z.text(),
        // Not providing maxDuration, should default to 1 second
        handler: mockHandler,
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    await app.batcher.push("A");
    expect(mockHandler).not.toHaveBeenCalled();

    // Wait for default timeout (1 second)
    await time.travel([1.1, "seconds"]);

    await vi.waitFor(() => {
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });
    expect(mockHandler).toHaveBeenCalledWith(["A"]);
  });

  test("should use default concurrency (1)", async () => {
    let activeHandlers = 0;
    let maxActiveHandlers = 0;

    const slowHandler = vi.fn(async (items: any[]) => {
      activeHandlers++;
      maxActiveHandlers = Math.max(maxActiveHandlers, activeHandlers);
      await time.wait(100);
      activeHandlers--;
    });

    class TestApp {
      batcher = $batch({
        schema: z.text(),
        maxSize: 1,
        // Not providing concurrency, should default to 1
        handler: slowHandler,
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    // Push 3 items to trigger 3 batches
    const ids = await Promise.all([
      app.batcher.push("A"),
      app.batcher.push("B"),
      app.batcher.push("C"),
    ]);

    await Promise.all(ids.map((id) => app.batcher.wait(id)));

    expect(slowHandler).toHaveBeenCalledTimes(3);
    expect(maxActiveHandlers).toBe(1); // Should never exceed default concurrency of 1
  });

  test("should track item status through lifecycle", async () => {
    class TestApp {
      batcher = $batch({
        schema: z.text(),
        maxSize: 10,
        maxDuration: [100, "milliseconds"],
        handler: async (items: string[]) => {
          await time.wait(50);
          return items.map((item) => `processed-${item}`);
        },
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    // Push an item and verify it gets an ID
    const id = await app.batcher.push("test-item");
    expect(typeof id).toBe("string");

    // Status should be pending initially
    let status = app.batcher.status(id);
    expect(status?.status).toMatch(/pending/);

    // Wait for processing to complete
    const result = await app.batcher.wait(id);
    expect(result).toEqual(["processed-test-item"]);

    // Status should now be completed
    status = app.batcher.status(id);
    expect(status?.status).toBe("completed");
    if (status?.status === "completed") {
      expect(status.result).toEqual(["processed-test-item"]);
    }

    // Calling wait again should return the cached result immediately
    const result2 = await app.batcher.wait(id);
    expect(result2).toEqual(["processed-test-item"]);

    // Test non-existent ID
    const nonExistentStatus = app.batcher.status("non-existent-id");
    expect(nonExistentStatus).toBeUndefined();

    await expect(app.batcher.wait("non-existent-id")).rejects.toThrow(
      "Item with id 'non-existent-id' not found",
    );
  });

  test("should restart timeout for items that arrive during flush (maxDuration bug)", async () => {
    const mockHandler = vi.fn(async (items: string[]) => {
      // Simulate slow processing
      await time.wait(50);
      return items.map((item) => `processed-${item}`);
    });

    class TestApp {
      batcher = $batch({
        schema: z.text(),
        maxSize: 10,
        maxDuration: [100, "milliseconds"],
        handler: mockHandler,
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    // Push first item, timeout starts
    const id1 = await app.batcher.push("A");

    // Wait for timeout to fire and flush to start
    await time.travel([100, "milliseconds"]);

    // Handler is now processing (takes 50ms)
    // At T=25ms into processing, push another item
    await time.wait(25);
    const id2 = await app.batcher.push("B");

    // Wait for first flush to complete
    await time.wait(30); // Total 55ms, first flush completes at 50ms

    // At this point:
    // - First batch ["A"] has been processed
    // - Item "B" is waiting in the partition
    // - BUG: No timeout exists for "B" because it was pushed during flush

    expect(mockHandler).toHaveBeenCalledTimes(1);
    expect(mockHandler).toHaveBeenCalledWith(["A"]);

    // Item "B" should flush after maxDuration (100ms)
    await time.travel([110, "milliseconds"]); // More than enough time

    // Expected: 2 calls (first batch "A", second batch "B")
    // Without fix: 1 call (only "A" was processed, "B" is stuck)
    await vi.waitFor(
      () => {
        expect(mockHandler).toHaveBeenCalledTimes(2);
      },
      { timeout: 200 },
    );
    expect(mockHandler).toHaveBeenNthCalledWith(2, ["B"]);

    // Verify both items completed successfully
    const result1 = await app.batcher.wait(id1);
    const result2 = await app.batcher.wait(id2);
    expect(result1).toEqual(["processed-A"]);
    expect(result2).toEqual(["processed-B"]);
  });

  test("should return unique IDs for each push", async () => {
    const mockHandler = createMockHandler();
    class TestApp {
      batcher = $batch({
        schema: z.text(),
        maxSize: 10,
        handler: mockHandler,
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    const id1 = await app.batcher.push("A");
    const id2 = await app.batcher.push("B");
    const id3 = await app.batcher.push("C");

    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);

    // All should be valid UUIDs (rough check)
    expect(id1).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(id2).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(id3).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
