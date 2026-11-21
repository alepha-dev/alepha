import { Alepha, AlephaError } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import {
  MemoryShellProvider,
  NodeShellProvider,
  ShellProvider,
} from "alepha/system";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

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

  it("should run a shell command and log its start and finish", async ({
    expect,
  }) => {
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
    expect(mockShell.wasCalled(`echo "hello"`)).toBe(true);
  });

  it("should run a named function task and log its start and finish", async ({
    expect,
  }) => {
    const mockFn = vi.fn();
    await runner.run("my-test-function", mockFn);

    expect(mockFn).toHaveBeenCalledOnce();
    expect(mockLogger.logs).toHaveLength(2);
    expect(mockLogger.logs[0].message).toBe("Starting 'my-test-function' ...");
    expect(mockLogger.logs[1].message).toMatch(
      /^Finished 'my-test-function' after \d+\.\ds$/,
    );
  });

  it("should execute an array of tasks in parallel", async ({ expect }) => {
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
  });

  it("should throw an error naming the task for a failing shell command", async ({
    expect,
  }) => {
    mockShell.errors.set("exit 1", "Command failed with exit code 1");
    await expect(runner.run(`exit 1`)).rejects.toThrow("Task 'exit 1' failed");
  });

  it("should throw an error naming the task, with the failure as its cause", async ({
    expect,
  }) => {
    const error = new AlephaError("Function failed!");
    const failingFn = () => {
      throw error;
    };

    const thrown = await runner.run("failing-task", failingFn).then(
      () => undefined,
      (it: Error) => it,
    );

    expect(thrown?.message).toBe("Task 'failing-task' failed");
    expect(thrown?.cause).toBe(error);
    // No "Finished" line for a task that did not finish.
    expect(mockLogger.logs.map((l) => l.message)).toEqual([
      "Starting 'failing-task' ...",
    ]);
  });

  it("end() should print a total-time summary line after tasks run", async ({
    expect,
  }) => {
    await runner.run(`echo "Task 1"`);
    await runner.run("A slightly longer task name", () => {});

    mockLogger.clear();
    runner.end();

    const messages = mockLogger.logs.map((l) => l.message);
    expect(messages.some((m) => m.startsWith("Total time:"))).toBe(true);
  });

  it("end() should print nothing if no tasks were run", ({ expect }) => {
    runner.end();

    const logs = mockLogger.logs.map((l) => l.message);
    expect(logs.length).toBe(0);
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

    it("captures child output (capture:true) when below DEBUG", async ({
      expect,
    }) => {
      const { runner, shell } = build("info");
      await runner.run("echo hi");
      expect(shell.calls[0].options.capture).toBe(true);
    });

    it("streams child output (capture:false) when DEBUG is enabled", async ({
      expect,
    }) => {
      const { runner, shell } = build("debug");
      await runner.run("echo hi");
      expect(shell.calls[0].options.capture).toBe(false);
    });

    it("streams child output (capture:false) at trace level too", async ({
      expect,
    }) => {
      const { runner, shell } = build("trace");
      await runner.run("echo hi");
      expect(shell.calls[0].options.capture).toBe(false);
    });

    it("surfaces captured stdout and stderr when a task fails", async ({
      expect,
    }) => {
      const failing = () => {
        throw Object.assign(new AlephaError("boom"), {
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

    it("captures and returns child stdout when below DEBUG", async ({
      expect,
    }) => {
      const runner = build("info");
      const out = await runner.run("echo MARKER_INFO");
      expect(out).toContain("MARKER_INFO");
    });

    it("streams child output (returns empty) when DEBUG is enabled", async ({
      expect,
    }) => {
      const runner = build("debug");
      const out = await runner.run("echo MARKER_DEBUG");
      expect(out).toBe("");
    });
  });
});
