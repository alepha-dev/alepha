import { Alepha } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import {
  MemoryShellProvider,
  NodeShellProvider,
  ShellProvider,
} from "alepha/system";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Runner } from "../index.ts";

describe("Runner", () => {
  let mockLogger: MemoryDestinationProvider;
  let mockShell: MemoryShellProvider;
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
    mockShell = alepha.inject(MemoryShellProvider);
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
      /^Finished 'echo "hello"' after \d+\.\ds$/,
    );
    expect(finishLog.level).toBe("INFO");

    const timers = (runner as any).timers;
    expect(timers).toHaveLength(1);
    expect(timers[0].name).toBe('echo "hello"');
    expect(timers[0].duration).toMatch(/^\d+\.\ds$/);
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
      /^Finished 'my-test-function' after \d+\.\ds$/,
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
    mockShell.errors.set("exit 1", "Command failed with exit code 1");
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

  test("end() should print a total-time summary line after tasks run", async () => {
    await runner.run(`echo "Task 1"`);
    await runner.run("A slightly longer task name", () => {});

    mockLogger.clear();
    runner.end();

    const messages = mockLogger.logs.map((l) => l.message);
    expect(messages.some((m) => m.startsWith("Total time:"))).toBe(true);
  });

  test("end() should print nothing if no tasks were run", () => {
    runner.end();

    const logs = mockLogger.logs.map((l) => l.message);
    expect(logs.length).toBe(0);
  });

  test("should reset firstTaskStarted when starting a new command", async () => {
    // Simulate running command A
    runner.startCommand("cli", "commandA");
    await runner.run("task A1", () => {});
    await runner.run("task A2", () => {});
    runner.end();

    const logsAfterA = mockLogger.logs.length;
    expect(logsAfterA).toBeGreaterThan(0);

    // Clear logs for next command
    mockLogger.clear();

    // Simulate running command B (should get fresh start)
    runner.startCommand("cli", "commandB");
    await runner.run("task B1", () => {});
    runner.end();

    // Verify command B also logged properly (not reusing A's state)
    expect(mockLogger.logs.length).toBeGreaterThan(0);
    expect(mockLogger.logs[0].message).toBe("Starting 'task B1' ...");
  });

  test("should handle running same task name in different commands", async () => {
    // Run command with task "clean"
    runner.startCommand("cli", "build");
    await runner.run("clean", () => {});
    runner.end();

    mockLogger.clear();

    // Run another command with same task name "clean"
    runner.startCommand("cli", "verify");
    await runner.run("clean", () => {});
    runner.end();

    // Both should have executed and logged independently
    expect(mockLogger.logs[0].message).toBe("Starting 'clean' ...");
    expect(mockLogger.logs[1].message).toMatch(/^Finished 'clean' after/);
  });

  test("should log start and finish for duplicate task names in one command", async () => {
    runner.startCommand("cli", "verify");
    await runner.run("clean", () => {});
    await runner.run("lint", () => {});
    await runner.run("typecheck", () => {});
    await runner.run("clean", () => {}); // Same name as first task
    runner.end();

    const messages = mockLogger.logs.map((l) => l.message).join("\n");
    const cleanStarts = messages.match(/Starting 'clean'/g) ?? [];
    expect(cleanStarts.length).toBe(2);
    expect(messages).toContain("Starting 'lint' ...");
    expect(messages).toContain("Starting 'typecheck' ...");
  });

  describe("sub-process output gating", () => {
    const build = (level: string) => {
      const alepha = Alepha.create({ env: { LOG_LEVEL: level } }).with({
        provide: LogDestinationProvider,
        use: MemoryDestinationProvider,
      });
      return {
        runner: alepha.inject(Runner),
        shell: alepha.inject(MemoryShellProvider),
      };
    };

    test("captures child output (capture:true) when below DEBUG", async () => {
      const { runner, shell } = build("info");
      await runner.run("echo hi");
      expect(shell.calls[0].options.capture).toBe(true);
    });

    test("streams child output (capture:false) when DEBUG is enabled", async () => {
      const { runner, shell } = build("debug");
      await runner.run("echo hi");
      expect(shell.calls[0].options.capture).toBe(false);
    });

    test("streams child output (capture:false) at trace level too", async () => {
      const { runner, shell } = build("trace");
      await runner.run("echo hi");
      expect(shell.calls[0].options.capture).toBe(false);
    });

    test("surfaces captured stdout and stderr when a task fails", async () => {
      const failing = () => {
        throw Object.assign(new Error("boom"), {
          stdout: "OUT_TEXT",
          stderr: "ERR_TEXT",
        });
      };

      await expect(runner.run("failing", failing)).rejects.toThrow(
        "Task 'failing' failed",
      );

      const messages = mockLogger.logs.map((l) => l.message).join("\n");
      expect(messages).toContain("OUT_TEXT");
      expect(messages).toContain("ERR_TEXT");
    });
  });

  describe("sub-process output gating (integration, real shell)", () => {
    const build = (level: string) => {
      const alepha = Alepha.create({ env: { LOG_LEVEL: level } })
        .with({
          provide: LogDestinationProvider,
          use: MemoryDestinationProvider,
        })
        .with({ provide: ShellProvider, use: NodeShellProvider });
      return alepha.inject(Runner);
    };

    test("captures and returns child stdout when below DEBUG", async () => {
      const runner = build("info");
      const out = await runner.run("echo MARKER_INFO");
      expect(out).toContain("MARKER_INFO");
    });

    test("streams child output (returns empty) when DEBUG is enabled", async () => {
      const runner = build("debug");
      const out = await runner.run("echo MARKER_DEBUG");
      expect(out).toBe("");
    });
  });
});
