import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AlephaBatch, BatchProvider } from "../index.ts";

describe("BatchProvider", () => {
  let alepha: Alepha;
  let batchProvider: BatchProvider;
  let time: DateTimeProvider;

  beforeEach(async () => {
    alepha = Alepha.create().with(AlephaBatch);
    batchProvider = alepha.inject(BatchProvider);
    time = alepha.inject(DateTimeProvider);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  test("should create a batch context", () => {
    const handler = vi.fn();
    const context = batchProvider.createContext(alepha, { handler });

    expect(context).toBeDefined();
    expect(context.itemStates).toBeInstanceOf(Map);
    expect(context.partitions).toBeInstanceOf(Map);
    expect(context.activeHandlers).toEqual([]);
    expect(context.isShuttingDown).toBe(false);
    expect(context.isReady).toBe(false);
  });

  test("should push items and return unique IDs", () => {
    const handler = vi.fn();
    const context = batchProvider.createContext(alepha, { handler });

    const id1 = batchProvider.push(context, "item-1");
    const id2 = batchProvider.push(context, "item-2");

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);

    // Verify IDs are valid UUIDs
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(id1).toMatch(uuidRegex);
    expect(id2).toMatch(uuidRegex);
  });

  test("should store items in the correct partition", () => {
    const handler = vi.fn();
    const context = batchProvider.createContext(alepha, {
      handler,
      partitionBy: (item: { key: string; value: number }) => item.key,
    });

    batchProvider.push(context, { key: "A", value: 1 });
    batchProvider.push(context, { key: "B", value: 2 });
    batchProvider.push(context, { key: "A", value: 3 });

    expect(context.partitions.has("A")).toBe(true);
    expect(context.partitions.has("B")).toBe(true);

    const partitionA = context.partitions.get("A");
    const partitionB = context.partitions.get("B");

    expect(partitionA?.itemIds).toHaveLength(2);
    expect(partitionB?.itemIds).toHaveLength(1);
  });

  test("should use default partition when partitionBy is not provided", () => {
    const handler = vi.fn();
    const context = batchProvider.createContext(alepha, { handler });

    batchProvider.push(context, "item-1");
    batchProvider.push(context, "item-2");

    expect(context.partitions.has("default")).toBe(true);
    expect(context.partitions.get("default")?.itemIds).toHaveLength(2);
  });

  test("should get item status", () => {
    const handler = vi.fn();
    const context = batchProvider.createContext(alepha, { handler });

    const id = batchProvider.push(context, "item-1");

    const status = batchProvider.status(context, id);
    expect(status).toEqual({ status: "pending" });
  });

  test("should return undefined status for non-existent item", () => {
    const handler = vi.fn();
    const context = batchProvider.createContext(alepha, { handler });

    const status = batchProvider.status(context, "non-existent-id");
    expect(status).toBeUndefined();
  });

  test("should throw error when waiting for non-existent item", async () => {
    const handler = vi.fn();
    const context = batchProvider.createContext(alepha, { handler });

    await expect(
      batchProvider.wait(context, "non-existent-id"),
    ).rejects.toThrow("Item with id 'non-existent-id' not found");
  });

  test("should flush partition and process items", async () => {
    const handler = vi.fn(async (items: string[]) => {
      return items.map((item) => `processed-${item}`);
    });
    const context = batchProvider.createContext(alepha, { handler });

    const id1 = batchProvider.push(context, "item-1");
    const id2 = batchProvider.push(context, "item-2");

    await batchProvider.flush(context);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(["item-1", "item-2"]);

    // Check status after flush
    const status1 = batchProvider.status(context, id1);
    const status2 = batchProvider.status(context, id2);

    expect(status1?.status).toBe("completed");
    expect(status2?.status).toBe("completed");
  });

  test("should flush specific partition only", async () => {
    const handler = vi.fn(async (items: any[]) => "processed");
    const context = batchProvider.createContext(alepha, {
      handler,
      partitionBy: (item: { key: string; value: number }) => item.key,
    });

    batchProvider.push(context, { key: "A", value: 1 });
    batchProvider.push(context, { key: "B", value: 2 });

    await batchProvider.flush(context, "A");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith([{ key: "A", value: 1 }]);

    // Partition B should still have items
    expect(context.partitions.has("B")).toBe(true);
    expect(context.partitions.get("B")?.itemIds).toHaveLength(1);
  });

  test("should wait for item result after processing", async () => {
    const handler = vi.fn(async (items: string[]) => {
      return `batch-result-${items.length}`;
    });
    const context = batchProvider.createContext(alepha, { handler });

    const id = batchProvider.push(context, "item-1");

    // Start wait before flush (promise created)
    const waitPromise = batchProvider.wait(context, id);

    // Flush to process items
    await batchProvider.flush(context);

    const result = await waitPromise;
    expect(result).toBe("batch-result-1");
  });

  test("should return cached result on subsequent wait calls", async () => {
    const handler = vi.fn(async () => "result");
    const context = batchProvider.createContext(alepha, { handler });

    const id = batchProvider.push(context, "item");
    await batchProvider.flush(context);

    const result1 = await batchProvider.wait(context, id);
    const result2 = await batchProvider.wait(context, id);

    expect(result1).toBe("result");
    expect(result2).toBe("result");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("should handle handler errors and mark items as failed", async () => {
    const handler = vi.fn(async () => {
      throw new Error("Handler failed");
    });
    const context = batchProvider.createContext(alepha, { handler });

    const id = batchProvider.push(context, "item");

    await batchProvider.flush(context);

    const status = batchProvider.status(context, id);
    expect(status?.status).toBe("failed");
    if (status?.status === "failed") {
      expect(status.error.message).toBe("Handler failed");
    }
  });

  test("should reject wait promise on handler error", async () => {
    const handler = vi.fn(async () => {
      throw new Error("Handler failed");
    });
    const context = batchProvider.createContext(alepha, { handler });

    const id = batchProvider.push(context, "item");
    const waitPromise = batchProvider.wait(context, id);

    await batchProvider.flush(context);

    await expect(waitPromise).rejects.toThrow("Handler failed");
  });

  test("should respect maxSize when flushing", async () => {
    const handler = vi.fn(async (items: string[]) => `batch-${items.length}`);
    const context = batchProvider.createContext(alepha, {
      handler,
      maxSize: 2,
    });

    batchProvider.push(context, "item-1");
    batchProvider.push(context, "item-2");
    batchProvider.push(context, "item-3");
    batchProvider.push(context, "item-4");
    batchProvider.push(context, "item-5");

    // Mark context as ready to enable size-based flushing
    await batchProvider.markReady(context);

    // Should have flushed twice (2 items each), leaving 1 item
    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(2);
    });

    expect(handler).toHaveBeenNthCalledWith(1, ["item-1", "item-2"]);
    expect(handler).toHaveBeenNthCalledWith(2, ["item-3", "item-4"]);
  });

  test("should respect concurrency limit", async () => {
    // This test verifies that concurrency limits work by measuring
    // when handlers start - first 2 should start together, next 2 after delay

    const handlerStartTimes: number[] = [];

    const handler = vi.fn(async (items: string[]) => {
      const startTime = Date.now();
      handlerStartTimes.push(startTime);
      // Use a real delay (not time.wait) to ensure parallel execution
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "done";
    });

    const context = batchProvider.createContext(alepha, {
      handler,
      maxSize: 1,
      concurrency: 2,
      partitionBy: (item: string) => item, // Each item in its own partition
    });

    batchProvider.push(context, "a");
    batchProvider.push(context, "b");
    batchProvider.push(context, "c");
    batchProvider.push(context, "d");

    // Flush all partitions - this should respect concurrency
    await batchProvider.flush(context);

    expect(handler).toHaveBeenCalledTimes(4);

    // With concurrency=2, first 2 handlers should start at roughly the same time,
    // and the other 2 should start ~50ms later (after first batch completes)
    const [t1, t2, t3, t4] = handlerStartTimes;

    // First two should start within 10ms of each other
    expect(Math.abs(t1 - t2)).toBeLessThan(20);

    // Third and fourth should start after first batch (50ms later)
    // They should also start within 10ms of each other
    expect(Math.abs(t3 - t4)).toBeLessThan(20);

    // Gap between first and third should be around 50ms (handler duration)
    expect(t3 - t1).toBeGreaterThanOrEqual(40);
  });

  test("should markReady and start processing buffered items", async () => {
    const handler = vi.fn(async (items: string[]) => "processed");
    const context = batchProvider.createContext(alepha, {
      handler,
      maxSize: 5,
    });

    // Push items before marking ready
    batchProvider.push(context, "item-1");
    batchProvider.push(context, "item-2");
    batchProvider.push(context, "item-3");
    batchProvider.push(context, "item-4");
    batchProvider.push(context, "item-5");

    expect(handler).not.toHaveBeenCalled();
    expect(context.isReady).toBe(false);

    await batchProvider.markReady(context);

    expect(context.isReady).toBe(true);

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  test("should handle shutdown and flush all remaining items", async () => {
    const handler = vi.fn(async (items: string[]) => "processed");
    const context = batchProvider.createContext(alepha, {
      handler,
      maxSize: 100, // Large size to prevent auto-flush
    });

    batchProvider.push(context, "item-1");
    batchProvider.push(context, "item-2");

    expect(handler).not.toHaveBeenCalled();

    await batchProvider.shutdown(context);

    expect(context.isShuttingDown).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(["item-1", "item-2"]);
  });

  test("should handle empty flush gracefully", async () => {
    const handler = vi.fn();
    const context = batchProvider.createContext(alepha, { handler });

    await batchProvider.flush(context);

    expect(handler).not.toHaveBeenCalled();
  });

  test("should handle flush of non-existent partition gracefully", async () => {
    const handler = vi.fn();
    const context = batchProvider.createContext(alepha, { handler });

    await batchProvider.flush(context, "non-existent");

    expect(handler).not.toHaveBeenCalled();
  });

  test("should use default options when not specified", () => {
    const handler = vi.fn();
    const context = batchProvider.createContext(alepha, { handler });

    // Access protected methods through any cast for testing
    const provider = batchProvider as any;

    expect(provider.getMaxSize(context)).toBe(10);
    expect(provider.getConcurrency(context)).toBe(1);
    expect(provider.getMaxDuration(context)).toEqual([1, "second"]);
  });

  test("should use custom options when specified", () => {
    const handler = vi.fn();
    const context = batchProvider.createContext(alepha, {
      handler,
      maxSize: 50,
      concurrency: 5,
      maxDuration: [30, "seconds"],
    });

    const provider = batchProvider as any;

    expect(provider.getMaxSize(context)).toBe(50);
    expect(provider.getConcurrency(context)).toBe(5);
    expect(provider.getMaxDuration(context)).toEqual([30, "seconds"]);
  });

  test("should retry failed handler with retry options", async () => {
    let attempts = 0;
    const handler = vi.fn(async (items: string[]) => {
      attempts++;
      if (attempts < 3) {
        throw new Error("Temporary failure");
      }
      return "success";
    });

    const context = batchProvider.createContext(alepha, {
      handler,
      retry: { max: 3, backoff: 10 },
    });

    const id = batchProvider.push(context, "item");
    await batchProvider.flush(context);

    const status = batchProvider.status(context, id);
    expect(status?.status).toBe("completed");
    expect(handler).toHaveBeenCalledTimes(3);
  });

  test("should fail after max retries exceeded", async () => {
    const handler = vi.fn(async () => {
      throw new Error("Always fails");
    });

    const context = batchProvider.createContext(alepha, {
      handler,
      retry: { max: 2, backoff: 10 },
    });

    const id = batchProvider.push(context, "item");
    await batchProvider.flush(context);

    const status = batchProvider.status(context, id);
    expect(status?.status).toBe("failed");
    expect(handler).toHaveBeenCalledTimes(2);
  });

  test("should handle timeout-based flushing when ready", async () => {
    const handler = vi.fn(async (items: string[]) => "processed");
    const context = batchProvider.createContext(alepha, {
      handler,
      maxSize: 100,
      maxDuration: [100, "milliseconds"],
    });

    await batchProvider.markReady(context);

    batchProvider.push(context, "item-1");
    batchProvider.push(context, "item-2");

    expect(handler).not.toHaveBeenCalled();

    // Wait for timeout
    await time.travel([150, "milliseconds"]);

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });

    expect(handler).toHaveBeenCalledWith(["item-1", "item-2"]);
  });

  test("should not create timeout for items pushed before ready", async () => {
    const handler = vi.fn(async () => "processed");
    const context = batchProvider.createContext(alepha, {
      handler,
      maxSize: 100,
      maxDuration: [100, "milliseconds"],
    });

    // Push before ready
    batchProvider.push(context, "item");

    // Travel time forward before marking ready
    await time.travel([200, "milliseconds"]);

    // Handler should NOT have been called
    expect(handler).not.toHaveBeenCalled();

    // Now mark ready
    await batchProvider.markReady(context);

    // Wait for timeout
    await time.travel([150, "milliseconds"]);

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  test("should handle items arriving during flush", async () => {
    let flushCount = 0;
    const handler = vi.fn(async (items: string[]) => {
      flushCount++;
      await time.wait(50); // Simulate slow processing
      return `batch-${flushCount}`;
    });

    const context = batchProvider.createContext(alepha, {
      handler,
      maxSize: 2,
    });

    await batchProvider.markReady(context);

    // Push 2 items to trigger first flush
    batchProvider.push(context, "item-1");
    batchProvider.push(context, "item-2");

    // Wait for processing to start
    await time.wait(10);

    // Push more items during processing
    batchProvider.push(context, "item-3");
    batchProvider.push(context, "item-4");

    // Wait for all processing
    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(2);
    });

    expect(handler).toHaveBeenNthCalledWith(1, ["item-1", "item-2"]);
    expect(handler).toHaveBeenNthCalledWith(2, ["item-3", "item-4"]);
  });

  test("should skip retries during shutdown", async () => {
    let attempts = 0;
    const handler = vi.fn(async () => {
      attempts++;
      throw new Error("Always fails");
    });

    const context = batchProvider.createContext(alepha, {
      handler,
      retry: { max: 5, backoff: 100 },
    });

    batchProvider.push(context, "item");

    // Shutdown should call handler directly without retries
    await batchProvider.shutdown(context);

    // Handler should only be called once (no retries during shutdown)
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("should mark items as processing during flush", async () => {
    let statusDuringProcessing: any;
    const handler = vi.fn(async (items: string[]) => {
      // Capture status while processing
      statusDuringProcessing = batchProvider.status(context, id);
      await time.wait(10);
      return "done";
    });

    const context = batchProvider.createContext(alepha, { handler });

    const id = batchProvider.push(context, "item");

    // Status before flush
    expect(batchProvider.status(context, id)?.status).toBe("pending");

    const flushPromise = batchProvider.flush(context);

    await flushPromise;

    // Status should have been "processing" during handler execution
    expect(statusDuringProcessing?.status).toBe("processing");

    // Status after flush
    expect(batchProvider.status(context, id)?.status).toBe("completed");
  });

  test("should clear partition timeout on flush", async () => {
    const handler = vi.fn(async () => "processed");
    const context = batchProvider.createContext(alepha, {
      handler,
      maxSize: 100,
      maxDuration: [5, "seconds"],
    });

    await batchProvider.markReady(context);

    batchProvider.push(context, "item");

    const partition = context.partitions.get("default");
    expect(partition?.timeout).toBeDefined();

    await batchProvider.flush(context);

    // Partition should be deleted after flush
    expect(context.partitions.has("default")).toBe(false);
  });

  test("should restart timeout after flush if items remain", async () => {
    const handler = vi.fn(async (items: string[]) => {
      // Slow handler to allow new items to arrive
      await time.wait(50);
      return "processed";
    });

    const context = batchProvider.createContext(alepha, {
      handler,
      maxSize: 2,
      maxDuration: [100, "milliseconds"],
    });

    await batchProvider.markReady(context);

    // Push 2 items to trigger flush
    batchProvider.push(context, "item-1");
    batchProvider.push(context, "item-2");

    // Wait for processing to start
    await time.wait(10);

    // Push another item during processing
    batchProvider.push(context, "item-3");

    // Wait for first flush to complete
    await time.wait(100);

    // Partition should still exist with timeout for item-3
    const partition = context.partitions.get("default");
    if (partition && partition.itemIds.length > 0) {
      expect(partition.timeout).toBeDefined();
    }

    // Wait for timeout to flush item-3
    await time.travel([150, "milliseconds"]);

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(2);
    });

    expect(handler).toHaveBeenNthCalledWith(2, ["item-3"]);
  });

  // Tests for new quick win features

  test("should clear completed items with clearCompleted", async () => {
    const handler = vi.fn(async () => "result");
    const context = batchProvider.createContext(alepha, { handler });

    const id1 = batchProvider.push(context, "item-1");
    const id2 = batchProvider.push(context, "item-2");
    const id3 = batchProvider.push(context, "item-3");

    await batchProvider.flush(context);

    // All items should be completed
    expect(context.itemStates.size).toBe(3);

    // Clear completed items
    const cleared = batchProvider.clearCompleted(context);

    expect(cleared).toBe(3);
    expect(context.itemStates.size).toBe(0);
  });

  test("should clear only failed items when status filter is provided", async () => {
    // Use partitionBy to control which items fail
    const handler = vi.fn(async (items: Array<{ type: string }>) => {
      if (items[0].type === "fail") {
        throw new Error("This batch fails");
      }
      return "success";
    });

    const context = batchProvider.createContext(alepha, {
      handler,
      maxSize: 1,
      retry: { max: 1 }, // Disable retries - only 1 attempt
      partitionBy: (item: { type: string }) => item.type,
    });

    batchProvider.push(context, { type: "fail" }); // Will fail
    batchProvider.push(context, { type: "success" }); // Will succeed

    await batchProvider.flush(context);

    expect(context.itemStates.size).toBe(2);

    // Clear only failed items
    const cleared = batchProvider.clearCompleted(context, "failed");

    expect(cleared).toBe(1);
    expect(context.itemStates.size).toBe(1);

    // The remaining item should be completed
    const remaining = Array.from(context.itemStates.values())[0];
    expect(remaining.status).toBe("completed");
  });

  test("should clear only completed items when status filter is provided", async () => {
    // Use partitionBy to control which items fail
    const handler = vi.fn(async (items: Array<{ type: string }>) => {
      if (items[0].type === "fail") {
        throw new Error("This batch fails");
      }
      return "success";
    });

    const context = batchProvider.createContext(alepha, {
      handler,
      maxSize: 1,
      retry: { max: 1 }, // Disable retries - only 1 attempt
      partitionBy: (item: { type: string }) => item.type,
    });

    batchProvider.push(context, { type: "fail" }); // Will fail
    batchProvider.push(context, { type: "success" }); // Will succeed

    await batchProvider.flush(context);

    // Clear only completed items
    const cleared = batchProvider.clearCompleted(context, "completed");

    expect(cleared).toBe(1);
    expect(context.itemStates.size).toBe(1);

    // The remaining item should be failed
    const remaining = Array.from(context.itemStates.values())[0];
    expect(remaining.status).toBe("failed");
  });

  test("should enforce maxQueueSize limit", () => {
    const handler = vi.fn();
    const context = batchProvider.createContext(alepha, {
      handler,
      maxQueueSize: 3,
    });

    // Push up to the limit
    batchProvider.push(context, "item-1");
    batchProvider.push(context, "item-2");
    batchProvider.push(context, "item-3");

    // Fourth push should throw
    expect(() => batchProvider.push(context, "item-4")).toThrow(
      "Batch queue size exceeded for partition 'default' (max: 3)",
    );
  });

  test("should not leak item state when maxQueueSize rejects", () => {
    // The state was registered before the size check threw, so the caller
    // never got the id, the item joined no partition and stayed "pending"
    // forever — the map grew on every rejected push under backpressure.
    const handler = vi.fn();
    const context = batchProvider.createContext(alepha, {
      handler,
      maxQueueSize: 2,
    });

    batchProvider.push(context, "item-1");
    batchProvider.push(context, "item-2");
    const sizeAtLimit = context.itemStates.size;

    for (let i = 0; i < 5; i++) {
      expect(() => batchProvider.push(context, `rejected-${i}`)).toThrow();
    }

    expect(context.itemStates.size).toBe(sizeAtLimit);
  });

  test("should enforce maxQueueSize per partition", () => {
    const handler = vi.fn();
    const context = batchProvider.createContext(alepha, {
      handler,
      maxQueueSize: 2,
      partitionBy: (item: { key: string; value: number }) => item.key,
    });

    // Fill partition A
    batchProvider.push(context, { key: "A", value: 1 });
    batchProvider.push(context, { key: "A", value: 2 });

    // Partition A is full, but B should still work
    batchProvider.push(context, { key: "B", value: 1 });

    // Partition A should throw
    expect(() => batchProvider.push(context, { key: "A", value: 3 })).toThrow(
      "Batch queue size exceeded for partition 'A' (max: 2)",
    );

    // Partition B should still accept
    batchProvider.push(context, { key: "B", value: 2 });
  });

  test("should handle partitionBy errors gracefully", () => {
    const handler = vi.fn();
    const context = batchProvider.createContext(alepha, {
      handler,
      partitionBy: (item: { key?: string; value?: string }) => {
        if (!item.key) {
          throw new Error("Missing key");
        }
        return item.key;
      },
    });

    // Item with key should work
    batchProvider.push(context, { key: "A" });
    expect(context.partitions.has("A")).toBe(true);

    // Item without key should fall back to 'default' partition
    batchProvider.push(context, { value: "no-key" });
    expect(context.partitions.has("default")).toBe(true);
    expect(context.partitions.get("default")?.itemIds).toHaveLength(1);
  });

  test("should return 0 when clearing with no completed items", () => {
    const handler = vi.fn();
    const context = batchProvider.createContext(alepha, { handler });

    // Push items but don't flush
    batchProvider.push(context, "item-1");
    batchProvider.push(context, "item-2");

    const cleared = batchProvider.clearCompleted(context);

    expect(cleared).toBe(0);
    expect(context.itemStates.size).toBe(2);
  });
});
