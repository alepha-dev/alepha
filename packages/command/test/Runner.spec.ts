import { Alepha } from "@alepha/core";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "@alepha/logger";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Runner } from "../src";

describe("Runner", () => {
  let mockLogger: MemoryDestinationProvider;
  let runner: Runner;

  beforeEach(async () => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "info",
      },
    }).with({
      provide: LogDestinationProvider,
      use: MemoryDestinationProvider,
    });
    // Create a new MockLogger and Runner for each test to ensure isolation
    runner = alepha.inject(Runner);
    mockLogger = alepha.inject(MemoryDestinationProvider);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should execute a single shell command via run.sh", async () => {
    await runner.run(`echo "hello"`);

    expect(mockLogger.logs).toHaveLength(2);
    const startLog = mockLogger.logs[0];
    const finishLog = mockLogger.logs[1];

    expect(startLog.message).toBe("Starting 'echo \"hello\"' ...");
    expect(startLog.level).toBe("INFO");

    expect(finishLog.message).toMatch(
      /^Finished 'echo "hello"' after \d+\.\d{2}s$/,
    );
    expect(finishLog.level).toBe("INFO");

    const timers = (runner as any).timers;
    expect(timers).toHaveLength(1);
    expect(timers[0].name).toBe('echo "hello"');
    expect(timers[0].duration).toMatch(/^\d+\.\d{2} s$/);
  });

  test("should execute a single shell command via run(sh`...`)", async () => {
    await runner.run(`echo "world"`);
    expect(mockLogger.logs[0].message).toBe("Starting 'echo \"world\"' ...");
    expect(mockLogger.logs).toHaveLength(2);
  });

  test("should execute a single function task via run.fn", async () => {
    const mockFn = vi.fn();
    await runner.run("my-test-function", mockFn);

    expect(mockFn).toHaveBeenCalledOnce();
    expect(mockLogger.logs).toHaveLength(2);
    expect(mockLogger.logs[0].message).toBe("Starting 'my-test-function' ...");
    expect(mockLogger.logs[1].message).toMatch(
      /^Finished 'my-test-function' after \d+\.\d{2}s$/,
    );
  });

  test("should execute a single function task via run(fn(...))", async () => {
    const mockFn = vi.fn();
    await runner.run("another-function", mockFn);
    expect(mockFn).toHaveBeenCalledOnce();
    expect(mockLogger.logs).toHaveLength(2);
  });

  test("should execute an array of tasks in parallel", async () => {
    const fn1 = vi.fn(() => new Promise((res) => setTimeout(res, 20)));
    const fn2 = vi.fn(() => new Promise((res) => setTimeout(res, 20)));

    await runner.run([
      `echo "parallel sh"`,
      { name: "parallel fn 1", handler: fn1 },
      { name: "parallel fn 2", handler: fn2 },
    ]);

    expect(fn1).toHaveBeenCalledOnce();
    expect(fn2).toHaveBeenCalledOnce();
    expect(mockLogger.logs).toHaveLength(6); // 3 start, 3 finish logs
    expect((runner as any).timers).toHaveLength(3);
  });

  test("should throw and log an error for a failing shell command", async () => {
    await expect(runner.run(`exit 1`)).rejects.toThrow("Task 'exit 1' failed");
  });

  test("should throw and log an error for a failing function task", async () => {
    const error = new Error("Function failed!");
    const failingFn = () => {
      throw error;
    };

    await expect(runner.run("failing-task", failingFn)).rejects.toThrow(
      "Task 'failing-task' failed",
    );
  });

  test("summary() should print a formatted table of executed tasks", async () => {
    await runner.run(`echo "Task 1"`);
    await runner.run("A slightly longer task name", () => {});

    runner.summary();

    const logs = mockLogger.logs
      .slice(4)
      .map((l) => l.message)
      .join("\n");
  });

  test("summary() should not print a table if no tasks were run", () => {
    runner.summary();

    const logs = mockLogger.logs.map((l) => l.message);
    expect(logs.length).toBe(0);
  });
});
