import { MockLogger } from "@alepha/core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Runner } from "../src";

describe("Runner", () => {
	let mockLogger: MockLogger;
	let runner: Runner;

	beforeEach(() => {
		// Create a new MockLogger and Runner for each test to ensure isolation
		mockLogger = new MockLogger();
		runner = new Runner(mockLogger);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	test("should execute a single shell command via run.sh", async () => {
		await runner.run(`echo "hello"`);

		expect(mockLogger.store.stack).toHaveLength(2);
		const startLog = mockLogger.store.stack[0];
		const finishLog = mockLogger.store.stack[1];

		expect(startLog.message).toBe("Starting 'echo \"hello\"' ...");
		expect(startLog.level).toBe("info");

		expect(finishLog.message).toMatch(
			/^Finished 'echo "hello"' after \d+\.\d{2}s$/,
		);
		expect(finishLog.level).toBe("info");

		const timers = (runner as any).timers;
		expect(timers).toHaveLength(1);
		expect(timers[0].name).toBe('echo "hello"');
		expect(timers[0].duration).toMatch(/^\d+\.\d{2} s$/);
	});

	test("should execute a single shell command via run(sh`...`)", async () => {
		await runner.run(`echo "world"`);
		expect(mockLogger.store.stack[0].message).toBe(
			"Starting 'echo \"world\"' ...",
		);
		expect(mockLogger.store.stack).toHaveLength(2);
	});

	test("should execute a single function task via run.fn", async () => {
		const mockFn = vi.fn();
		await runner.run("my-test-function", mockFn);

		expect(mockFn).toHaveBeenCalledOnce();
		expect(mockLogger.store.stack).toHaveLength(2);
		expect(mockLogger.store.stack[0].message).toBe(
			"Starting 'my-test-function' ...",
		);
		expect(mockLogger.store.stack[1].message).toMatch(
			/^Finished 'my-test-function' after \d+\.\d{2}s$/,
		);
	});

	test("should execute a single function task via run(fn(...))", async () => {
		const mockFn = vi.fn();
		await runner.run("another-function", mockFn);
		expect(mockFn).toHaveBeenCalledOnce();
		expect(mockLogger.store.stack).toHaveLength(2);
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
		expect(mockLogger.store.stack).toHaveLength(6); // 3 start, 3 finish logs
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

		const logs = mockLogger.store.stack
			.slice(4)
			.map((l) => l.message)
			.join("\n");

		expect(logs).toContain('| echo "Task 1"');
		expect(logs).toContain("| A slightly longer task name");
	});

	test("summary() should not print a table if no tasks were run", () => {
		runner.summary();

		const logs = mockLogger.store.stack.map((l) => l.message);
		expect(logs.join("")).not.toContain("|"); // No table dividers
		expect(logs[0]).toBe("");
		expect(logs[1]).toMatch(/^Total time: \d+\.\d{2} s$/);
	});
});
