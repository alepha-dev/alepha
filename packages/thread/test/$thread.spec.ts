import { Alepha, t } from "@alepha/core";
import { afterEach, beforeEach, describe, it } from "vitest";
import { $thread, AlephaThread, ThreadDescriptor } from "../src";

class TestApp {
  testThread = $thread({
    name: "test-thread",
    handler: async () => {
      return { message: "Hello from thread!", timestamp: Date.now() };
    },
  });
}

describe("$thread", () => {
  let threadDescriptor: ThreadDescriptor;
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = Alepha.create().with(AlephaThread).with(TestApp);
    threadDescriptor = alepha.inject(TestApp).testThread;
  });

  afterEach(async () => {
    if (threadDescriptor) {
      await threadDescriptor.terminate();
    }
    if (alepha) {
      await alepha.stop();
    }
  });

  it("should create a thread descriptor", ({ expect }) => {
    expect($thread).toBeDefined();
    expect(threadDescriptor).toBeInstanceOf(ThreadDescriptor);
    expect(threadDescriptor.name).toBe("test-thread");
  });

  it("should have correct default configuration", async ({ expect }) => {
    class DefaultTestApp {
      defaultThread = $thread({
        handler: async () => "test",
      });
    }

    const testAlepha = Alepha.create().with(AlephaThread).with(DefaultTestApp);
    const defaultThread = testAlepha.inject(DefaultTestApp).defaultThread;

    expect(defaultThread.maxPoolSize).toBeGreaterThan(0);
    expect(defaultThread.idleTimeout).toBe(60000); // 1 minute

    await testAlepha.stop();
  });

  it("should allow custom pool size and idle timeout", async ({ expect }) => {
    class CustomTestApp {
      customThread = $thread({
        name: "custom-thread",
        handler: async () => "test",
        maxPoolSize: 4,
        idleTimeout: 30000,
      });
    }

    const testAlepha = Alepha.create().with(AlephaThread).with(CustomTestApp);
    const customThread = testAlepha.inject(CustomTestApp).customThread;

    expect(customThread.maxPoolSize).toBe(4);
    expect(customThread.idleTimeout).toBe(30000);

    await testAlepha.stop();
  });

  it("should validate data with TypeBox schema", async ({ expect }) => {
    const schema = t.object({
      name: t.text(),
      age: t.number(),
    });

    // Invalid data should throw validation error
    await expect(
      threadDescriptor.execute({ name: "John" }, schema),
    ).rejects.toThrow("Invalid data");
  });

  it("should warm up thread pool", async ({ expect }) => {
    await expect(threadDescriptor.create()).resolves.toBeUndefined();
  });

  it("should terminate thread pool", async ({ expect }) => {
    await threadDescriptor.create();
    await expect(threadDescriptor.terminate()).resolves.toBeUndefined();
  });
});

describe("Thread descriptor configuration", () => {
  let testAlepha: Alepha;

  beforeEach(async () => {
    testAlepha = Alepha.create().with(AlephaThread);
  });

  afterEach(async () => {
    if (testAlepha) {
      await testAlepha.stop();
    }
  });

  it("should handle different configuration options", async ({ expect }) => {
    class ConfigTestApp {
      defaultThread = $thread({
        handler: async () => "default",
      });

      namedThread = $thread({
        name: "custom-name",
        handler: async () => "named",
      });

      configuredThread = $thread({
        name: "configured",
        handler: async () => "configured",
        maxPoolSize: 8,
        idleTimeout: 120000,
      });
    }

    testAlepha = testAlepha.with(ConfigTestApp);
    const app = testAlepha.inject(ConfigTestApp);

    // Test default configuration
    expect(app.defaultThread.maxPoolSize).toBeGreaterThan(0);
    expect(app.defaultThread.idleTimeout).toBe(60000);

    // Test named thread
    expect(app.namedThread.name).toBe("custom-name");

    // Test configured thread
    expect(app.configuredThread.name).toBe("configured");
    expect(app.configuredThread.maxPoolSize).toBe(8);
    expect(app.configuredThread.idleTimeout).toBe(120000);
  });
});

describe("Thread pool management", () => {
  let testAlepha: Alepha;

  beforeEach(async () => {
    testAlepha = Alepha.create().with(AlephaThread);
  });

  afterEach(async () => {
    if (testAlepha) {
      await testAlepha.stop();
    }
  });

  it("should have consistent pool instances", async ({ expect }) => {
    class PoolTestApp {
      thread1 = $thread({
        name: "shared-pool",
        handler: async () => "thread1",
      });

      thread2 = $thread({
        name: "shared-pool", // Same name = shared pool
        handler: async () => "thread2",
      });

      thread3 = $thread({
        name: "different-pool",
        handler: async () => "thread3",
      });
    }

    testAlepha = testAlepha.with(PoolTestApp);
    const app = testAlepha.inject(PoolTestApp);

    // Threads with same name should share configuration
    expect(app.thread1.name).toBe(app.thread2.name);
    expect(app.thread3.name).not.toBe(app.thread1.name);

    // Clean up
    await app.thread1.terminate();
    await app.thread3.terminate();
  });
});
