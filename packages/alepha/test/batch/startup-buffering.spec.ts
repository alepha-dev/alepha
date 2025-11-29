import { $hook, Alepha, t } from "alepha";
import { $batch, AlephaBatch } from "alepha/batch";
import { DateTimeProvider } from "alepha/datetime";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Tests for startup buffering behavior.
 *
 * Requirements:
 * - During startup (before "ready" hook), items should be buffered in memory
 * - No size checks should occur during startup
 * - No timeouts should be created during startup
 * - After "ready" hook, all buffered items should be processed correctly
 * - Items pushed after "ready" should behave normally
 */
describe("Batch startup buffering", () => {
  let alepha: Alepha;
  let time: DateTimeProvider;

  beforeEach(() => {
    alepha = Alepha.create().with(AlephaBatch);
    time = alepha.inject(DateTimeProvider);
  });

  afterEach(async () => {
    await alepha.stop();
  });

  test("should buffer items during startup without size checks", async () => {
    const mockHandler = vi.fn(async (items: string[]) => {
      return `processed ${items.length} items`;
    });

    class TestApp {
      batcher = $batch({
        schema: t.text(),
        maxSize: 10, // Would normally trigger flush at 10 items
        maxDuration: [1, "second"],
        handler: mockHandler,
      });

      // Push items during start hook (before ready)
      onStart = $hook({
        on: "start",
        handler: async () => {
          // Push 15 items during startup (exceeds maxSize of 10)
          for (let i = 0; i < 15; i++) {
            await this.batcher.push(`startup-item-${i}`);
          }
        },
      });
    }

    const app = alepha.inject(TestApp);

    // Handler should not be called during startup
    expect(mockHandler).not.toHaveBeenCalled();

    await alepha.start();

    // After start completes (which includes "ready" hook), handler should be called
    await vi.waitFor(() => {
      expect(mockHandler).toHaveBeenCalled();
    });

    // Should have flushed once with 10 items (maxSize)
    // and started a timeout for the remaining 5 items
    expect(mockHandler).toHaveBeenCalledTimes(1);
    expect(mockHandler).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([
        "startup-item-0",
        "startup-item-1",
        "startup-item-2",
        "startup-item-3",
        "startup-item-4",
        "startup-item-5",
        "startup-item-6",
        "startup-item-7",
        "startup-item-8",
        "startup-item-9",
      ]),
    );

    // Wait for timeout to flush remaining items
    await time.travel([1.1, "seconds"]);

    await vi.waitFor(() => {
      expect(mockHandler).toHaveBeenCalledTimes(2);
    });

    expect(mockHandler).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([
        "startup-item-10",
        "startup-item-11",
        "startup-item-12",
        "startup-item-13",
        "startup-item-14",
      ]),
    );
  });

  test("should not create timeouts during startup", async () => {
    const mockHandler = vi.fn(async (items: string[]) => {
      return "processed";
    });

    class TestApp {
      batcher = $batch({
        schema: t.text(),
        maxSize: 100,
        maxDuration: [100, "milliseconds"], // Short timeout
        handler: mockHandler,
      });

      onStart = $hook({
        on: "start",
        handler: async () => {
          // Push 5 items during startup
          await this.batcher.push("item-1");
          await this.batcher.push("item-2");
          await this.batcher.push("item-3");
          await this.batcher.push("item-4");
          await this.batcher.push("item-5");
        },
      });
    }

    const app = alepha.inject(TestApp);

    // Travel time forward before starting (should have no effect)
    await time.travel([200, "milliseconds"]);

    // Handler should still not be called
    expect(mockHandler).not.toHaveBeenCalled();

    await alepha.start();

    // After ready, timeout should be created
    // Wait for timeout to trigger
    await time.travel([150, "milliseconds"]);

    await vi.waitFor(() => {
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    expect(mockHandler).toHaveBeenCalledWith([
      "item-1",
      "item-2",
      "item-3",
      "item-4",
      "item-5",
    ]);
  });

  test("should handle 1000+ items pushed during startup", async () => {
    const mockHandler = vi.fn(async (items: string[]) => {
      return `batch of ${items.length}`;
    });

    class TestApp {
      batcher = $batch({
        schema: t.text(),
        maxSize: 100,
        maxDuration: [1, "second"],
        handler: mockHandler,
      });

      onStart = $hook({
        on: "start",
        handler: async () => {
          // Push 1000 items during startup
          const pushPromises: Promise<string>[] = [];
          for (let i = 0; i < 1000; i++) {
            pushPromises.push(this.batcher.push(`item-${i}`));
          }
          await Promise.all(pushPromises);
        },
      });
    }

    const app = alepha.inject(TestApp);

    // Handler should not be called during startup
    expect(mockHandler).not.toHaveBeenCalled();

    await alepha.start();

    // After ready, should flush batches of 100 items each
    await vi.waitFor(
      () => {
        // Should have 10 batches (1000 / 100)
        expect(mockHandler).toHaveBeenCalledTimes(10);
      },
      { timeout: 2000 },
    );

    // Each call should have 100 items
    for (let i = 0; i < 10; i++) {
      const call = mockHandler.mock.calls[i];
      expect(call[0]).toHaveLength(100);
    }
  });

  test("should handle partitioned items during startup", async () => {
    const mockHandler = vi.fn(async (items: any[]) => {
      return "processed";
    });

    class TestApp {
      batcher = $batch({
        schema: t.object({ partition: t.text(), value: t.text() }),
        maxSize: 5,
        partitionBy: (item) => item.partition,
        handler: mockHandler,
      });

      onStart = $hook({
        on: "start",
        handler: async () => {
          // Push items to different partitions
          await this.batcher.push({ partition: "A", value: "a1" });
          await this.batcher.push({ partition: "A", value: "a2" });
          await this.batcher.push({ partition: "B", value: "b1" });
          await this.batcher.push({ partition: "B", value: "b2" });
          await this.batcher.push({ partition: "A", value: "a3" });
          await this.batcher.push({ partition: "A", value: "a4" });
          await this.batcher.push({ partition: "A", value: "a5" });
          // Partition A now has 5 items (maxSize)
          await this.batcher.push({ partition: "A", value: "a6" });
          // Partition A now has 6 items (exceeds maxSize during startup - should NOT flush)
        },
      });
    }

    const app = alepha.inject(TestApp);

    // No flushes during startup
    expect(mockHandler).not.toHaveBeenCalled();

    await alepha.start();

    // After ready, partition A should flush immediately (6 > 5)
    // It will flush 5 items first (maxSize), leaving 1 item
    await vi.waitFor(() => {
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    // Should flush partition A with 5 items (first batch of maxSize)
    const firstCall = mockHandler.mock.calls[0][0];
    expect(firstCall).toHaveLength(5);
    expect(firstCall).toEqual([
      { partition: "A", value: "a1" },
      { partition: "A", value: "a2" },
      { partition: "A", value: "a3" },
      { partition: "A", value: "a4" },
      { partition: "A", value: "a5" },
    ]);

    // Partition A has 1 remaining item and partition B has 2 items
    // Wait for timeout to flush them
    await time.travel([1.1, "seconds"]);

    await vi.waitFor(() => {
      expect(mockHandler).toHaveBeenCalledTimes(3);
    });

    // Second call should be the remaining item from partition A
    const secondCall = mockHandler.mock.calls[1][0];
    expect(secondCall).toHaveLength(1);
    expect(secondCall).toEqual([{ partition: "A", value: "a6" }]);

    // Third call should be partition B
    const thirdCall = mockHandler.mock.calls[2][0];
    expect(thirdCall).toHaveLength(2);
    expect(thirdCall).toEqual([
      { partition: "B", value: "b1" },
      { partition: "B", value: "b2" },
    ]);
  });

  test("should work correctly when items are pushed both during and after startup", async () => {
    const mockHandler = vi.fn(async (items: string[]) => {
      return "processed";
    });

    class TestApp {
      batcher = $batch({
        schema: t.text(),
        maxSize: 3,
        maxDuration: [500, "milliseconds"],
        handler: mockHandler,
      });

      onStart = $hook({
        on: "start",
        handler: async () => {
          await this.batcher.push("startup-1");
          await this.batcher.push("startup-2");
        },
      });
    }

    const app = alepha.inject(TestApp);

    // No handler calls yet
    expect(mockHandler).not.toHaveBeenCalled();

    await alepha.start();

    // After ready, timeout starts for the 2 startup items
    // Push another item (should trigger flush at maxSize=3)
    await app.batcher.push("runtime-1");

    await vi.waitFor(() => {
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    expect(mockHandler).toHaveBeenCalledWith([
      "startup-1",
      "startup-2",
      "runtime-1",
    ]);

    // Push more items after flush
    await app.batcher.push("runtime-2");
    await app.batcher.push("runtime-3");

    // Wait for timeout
    await time.travel([600, "milliseconds"]);

    await vi.waitFor(() => {
      expect(mockHandler).toHaveBeenCalledTimes(2);
    });

    expect(mockHandler).toHaveBeenNthCalledWith(2, ["runtime-2", "runtime-3"]);
  });

  test("should handle wait() for items pushed during startup", async () => {
    const mockHandler = vi.fn(async (items: string[]) => {
      return items.map((item) => `processed-${item}`);
    });

    class TestApp {
      batcher = $batch({
        schema: t.text(),
        maxSize: 10,
        handler: mockHandler,
      });

      startupIds: string[] = [];

      onStart = $hook({
        on: "start",
        handler: async () => {
          this.startupIds.push(await this.batcher.push("item-1"));
          this.startupIds.push(await this.batcher.push("item-2"));
          this.startupIds.push(await this.batcher.push("item-3"));
        },
      });
    }

    const app = alepha.inject(TestApp);

    await alepha.start();

    // Wait for all startup items to be processed
    const results = await Promise.all(
      app.startupIds.map((id) => app.batcher.wait(id)),
    );

    expect(results).toEqual([
      ["processed-item-1", "processed-item-2", "processed-item-3"],
      ["processed-item-1", "processed-item-2", "processed-item-3"],
      ["processed-item-1", "processed-item-2", "processed-item-3"],
    ]);
  });

  test("should immediately flush startup items that exceed maxSize on ready", async () => {
    const mockHandler = vi.fn(async (items: string[]) => {
      return "processed";
    });

    class TestApp {
      batcher = $batch({
        schema: t.text(),
        maxSize: 5,
        maxDuration: [10, "seconds"], // Long timeout so it doesn't interfere
        handler: mockHandler,
      });

      onStart = $hook({
        on: "start",
        handler: async () => {
          // Push exactly maxSize items
          for (let i = 0; i < 5; i++) {
            await this.batcher.push(`item-${i}`);
          }
        },
      });
    }

    const app = alepha.inject(TestApp);

    await alepha.start();

    // Should flush immediately on ready (5 >= maxSize)
    await vi.waitFor(() => {
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    expect(mockHandler).toHaveBeenCalledWith([
      "item-0",
      "item-1",
      "item-2",
      "item-3",
      "item-4",
    ]);
  });

  test("should handle status() for buffered items", async () => {
    const mockHandler = vi.fn(async (items: string[]) => {
      return "success";
    });

    class TestApp {
      batcher = $batch({
        schema: t.text(),
        maxSize: 10,
        handler: mockHandler,
      });

      itemId?: string;

      onStart = $hook({
        on: "start",
        handler: async () => {
          this.itemId = await this.batcher.push("test-item");
        },
      });
    }

    const app = alepha.inject(TestApp);

    await alepha.start();

    // Item should be pending or processing
    const status1 = app.batcher.status(app.itemId!);
    expect(status1?.status).toMatch(/pending|processing|completed/);

    // Wait for processing
    await app.batcher.wait(app.itemId!);

    const status2 = app.batcher.status(app.itemId!);
    expect(status2?.status).toBe("completed");
  });
});
