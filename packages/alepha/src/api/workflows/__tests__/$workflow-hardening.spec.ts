import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";
import {
  $workflow,
  AlephaApiWorkflows,
  WorkflowProvider,
  workflowExecutions,
  workflowStepExecutions,
} from "../index.ts";

// -----------------------------------------------------------------------------------------------------------------

/**
 * Poll `fn` until `predicate` returns true, or throw on timeout.
 */
async function waitFor<T>(
  fn: () => Promise<T> | T,
  predicate: (v: T) => boolean,
  { timeout = 10_000, interval = 10, label = "condition" } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  let last: T = await fn();
  while (Date.now() < deadline) {
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, interval));
    last = await fn();
  }
  if (predicate(last)) return last;
  throw new Error(
    `waitFor: ${label} not met within ${timeout}ms; last value: ${JSON.stringify(last)}`,
  );
}

const makeApp = () =>
  Alepha.create().with(AlephaOrmPostgres).with(AlephaApiWorkflows);

// -----------------------------------------------------------------------------------------------------------------

describe("$workflow — durable delays", () => {
  it("runs a delayed start only after the delay, surviving on travel()", async ({
    expect,
  }) => {
    let calls = 0;

    class App {
      repo = $repository(workflowExecutions);
      stepRepo = $repository(workflowStepExecutions);
      delayed = $workflow({
        schema: z.object({ id: z.text() }),
        steps: [
          {
            name: "step1",
            handler: async () => {
              calls++;
              return { ok: true };
            },
          },
        ],
      });
    }

    const alepha = makeApp().with(App);
    await alepha.start();

    const app = alepha.inject(App);
    const executionId = await app.delayed.start(
      { id: "later" },
      { delay: [5, "minute"] },
    );

    // Not started yet: pending, first step pinned to its not-before time.
    const exec = await app.repo.findById(executionId);
    expect(exec?.status).toBe("pending");
    expect(exec?.scheduledAt).toBeDefined();
    expect(calls).toBe(0);

    const steps = await app.stepRepo.findMany({
      where: { workflowExecutionId: { eq: executionId } },
    });
    expect(steps[0].scheduledAt).toBeDefined();

    // travel() releases the scheduled dispatch (and fires every cron in
    // the container — assert end state, not call counts).
    const dt = alepha.inject(DateTimeProvider);
    await dt.travel([6, "minute"]);

    await waitFor(
      () => app.repo.findById(executionId),
      (e) => e?.status === "completed",
      { label: "delayed workflow completed" },
    );
    expect(calls).toBe(1);
  });

  it("waits out a step-level delay between steps", async ({ expect }) => {
    const order: string[] = [];

    class App {
      repo = $repository(workflowExecutions);
      stepRepo = $repository(workflowStepExecutions);
      reminder = $workflow({
        schema: z.object({ id: z.text() }),
        steps: [
          {
            name: "immediate",
            handler: async () => {
              order.push("immediate");
              return { ok: true };
            },
          },
          {
            name: "afterDelay",
            delay: [2, "minute"],
            handler: async () => {
              order.push("afterDelay");
              return { ok: true };
            },
          },
        ],
      });
    }

    const alepha = makeApp().with(App);
    await alepha.start();

    const app = alepha.inject(App);
    const executionId = await app.reminder.start({ id: "seq" });

    // First step completes; the delayed one is stamped and parked. The
    // stamp lands a beat after the completion write, so poll for it.
    const parked = await waitFor(
      () =>
        app.stepRepo.findMany({
          where: {
            workflowExecutionId: { eq: executionId },
            stepName: { eq: "afterDelay" },
          },
        }),
      (steps) => steps[0]?.status === "pending" && !!steps[0]?.scheduledAt,
      { label: "delayed step stamped and parked" },
    );
    expect(parked[0].scheduledAt).toBeDefined();
    expect(order).toEqual(["immediate"]);

    const dt = alepha.inject(DateTimeProvider);
    await dt.travel([3, "minute"]);

    await waitFor(
      () => app.repo.findById(executionId),
      (e) => e?.status === "completed",
      { label: "workflow completed after step delay" },
    );
    expect(order).toEqual(["immediate", "afterDelay"]);
  });

  it("honours a delay on the FIRST step", async ({ expect }) => {
    let calls = 0;

    class App {
      repo = $repository(workflowExecutions);
      stepRepo = $repository(workflowStepExecutions);
      firstDelayed = $workflow({
        schema: z.object({ id: z.text() }),
        steps: [
          {
            name: "waitFirst",
            delay: [3, "minute"],
            handler: async () => {
              calls++;
              return { ok: true };
            },
          },
        ],
      });
    }

    const alepha = makeApp().with(App);
    await alepha.start();

    const app = alepha.inject(App);
    const executionId = await app.firstDelayed.start({ id: "first" });

    // Regression: step 0 never passes through advance(), so its delay
    // must be applied by start() — it used to run immediately.
    const steps = await app.stepRepo.findMany({
      where: { workflowExecutionId: { eq: executionId } },
    });
    expect(steps[0].scheduledAt).toBeDefined();
    expect(calls).toBe(0);

    const dt = alepha.inject(DateTimeProvider);
    await dt.travel([4, "minute"]);

    await waitFor(
      () => app.repo.findById(executionId),
      (e) => e?.status === "completed",
      { label: "first-step delay released" },
    );
    expect(calls).toBe(1);
  });

  it("does not run a delayed step that arrives early", async ({ expect }) => {
    let delayedRuns = 0;

    class App {
      repo = $repository(workflowExecutions);
      stepRepo = $repository(workflowStepExecutions);
      guarded = $workflow({
        schema: z.object({ id: z.text() }),
        steps: [
          {
            name: "first",
            handler: async () => ({ ok: true }),
          },
          {
            name: "later",
            delay: [10, "minute"],
            handler: async () => {
              delayedRuns++;
              return { ok: true };
            },
          },
        ],
      });
    }

    const alepha = makeApp().with(App);
    await alepha.start();

    const app = alepha.inject(App);
    const executionId = await app.guarded.start({ id: "early" });

    await waitFor(
      () =>
        app.stepRepo.findMany({
          where: {
            workflowExecutionId: { eq: executionId },
            stepName: { eq: "later" },
          },
        }),
      (steps) => steps[0]?.status === "pending" && !!steps[0]?.scheduledAt,
      { label: "delayed step parked" },
    );

    // A duplicate dispatch landing ahead of schedule must not run the
    // handler — the early-arrival guard re-parks it.
    const provider = alepha.inject(WorkflowProvider);
    await provider.processStep(executionId, "later");

    expect(delayedRuns).toBe(0);
    const parked = await app.stepRepo.findMany({
      where: {
        workflowExecutionId: { eq: executionId },
        stepName: { eq: "later" },
      },
    });
    expect(parked[0].status).toBe("pending");
  });
});

// -----------------------------------------------------------------------------------------------------------------

describe("$workflow — crash recovery", () => {
  it("recovery sweep re-dispatches a due pending retry after process death", async ({
    expect,
  }) => {
    let calls = 0;

    class App {
      repo = $repository(workflowExecutions);
      stepRepo = $repository(workflowStepExecutions);
      revived = $workflow({
        schema: z.object({ id: z.text() }),
        steps: [
          {
            name: "flaky",
            retry: { retries: 2 },
            handler: async () => {
              calls++;
              return { ok: true };
            },
          },
        ],
      });
    }

    const alepha = makeApp().with(App);
    await alepha.start();
    const app = alepha.inject(App);
    const dt = alepha.inject(DateTimeProvider);

    // Manufacture the post-crash state by hand: a running execution whose
    // pending retry was scheduled in the past, with no timer and no outbox
    // row alive (the process that scheduled them is "dead").
    const exec = await app.repo.create({
      workflowName: "App.revived",
      status: "running",
      priority: 2,
      payload: { id: "crashed" },
      startedAt: dt.nowISOString(),
      scheduledAt: dt.nowISOString(),
    });
    await app.stepRepo.create({
      workflowExecutionId: exec.id,
      stepName: "flaky",
      stepIndex: 0,
      status: "pending",
      attempt: 1,
      maxAttempts: 3,
      error: "boom",
      scheduledAt: dt.now().subtract(5, "minute").toISOString(),
    });

    const provider = alepha.inject(WorkflowProvider);
    await provider.recoverySweep();

    await waitFor(
      () => app.repo.findById(exec.id),
      (e) => e?.status === "completed",
      { label: "revived workflow completed" },
    );
    expect(calls).toBe(1);
  });

  it("recovery sweep fails a stale running step and compensates", async ({
    expect,
  }) => {
    const compensated: string[] = [];

    class App {
      repo = $repository(workflowExecutions);
      stepRepo = $repository(workflowStepExecutions);
      crashy = $workflow({
        schema: z.object({ id: z.text() }),
        onError: "compensate",
        steps: [
          {
            name: "done",
            handler: async () => ({ ok: true }),
            compensate: async () => {
              compensated.push("done");
            },
          },
          {
            name: "stuck",
            handler: async () => ({ ok: true }),
          },
        ],
      });
    }

    const alepha = makeApp().with(App);
    await alepha.start();
    const app = alepha.inject(App);
    const dt = alepha.inject(DateTimeProvider);

    const exec = await app.repo.create({
      workflowName: "App.crashy",
      status: "running",
      priority: 2,
      payload: { id: "stale" },
      startedAt: dt.nowISOString(),
      scheduledAt: dt.nowISOString(),
    });
    await app.stepRepo.create({
      workflowExecutionId: exec.id,
      stepName: "done",
      stepIndex: 0,
      status: "completed",
      attempt: 1,
      maxAttempts: 1,
      result: { ok: true },
      startedAt: dt.nowISOString(),
      completedAt: dt.nowISOString(),
    });
    await app.stepRepo.create({
      workflowExecutionId: exec.id,
      stepName: "stuck",
      stepIndex: 1,
      status: "running",
      attempt: 1,
      maxAttempts: 1,
      startedAt: dt.nowISOString(),
    });

    // Cross the stale threshold (default 30 min), then sweep.
    await dt.travel([35, "minute"]);
    const provider = alepha.inject(WorkflowProvider);
    await provider.recoverySweep();

    const finalExec = await waitFor(
      () => app.repo.findById(exec.id),
      (e) => e?.status === "compensated",
      { label: "crashed workflow compensated" },
    );
    expect(finalExec?.status).toBe("compensated");
    expect(compensated).toEqual(["done"]);

    const stuck = await app.stepRepo.findMany({
      where: {
        workflowExecutionId: { eq: exec.id },
        stepName: { eq: "stuck" },
      },
    });
    expect(stuck[0].status).toBe("failed");
  });

  it("recovery sweep re-stamps a delayed step whose stamp was lost, instead of running it early", async ({
    expect,
  }) => {
    let lateRuns = 0;

    class App {
      repo = $repository(workflowExecutions);
      stepRepo = $repository(workflowStepExecutions);
      stamped = $workflow({
        schema: z.object({ id: z.text() }),
        steps: [
          {
            name: "first",
            handler: async () => ({ ok: true }),
          },
          {
            name: "late",
            delay: [10, "minute"],
            handler: async () => {
              lateRuns++;
              return { ok: true };
            },
          },
        ],
      });
    }

    const alepha = makeApp().with(App);
    await alepha.start();
    const app = alepha.inject(App);
    const dt = alepha.inject(DateTimeProvider);

    // Crash window: first step completed, but the process died before
    // advance() could stamp the delayed step's not-before time.
    const exec = await app.repo.create({
      workflowName: "App.stamped",
      status: "running",
      priority: 2,
      payload: { id: "lost-stamp" },
      startedAt: dt.nowISOString(),
      scheduledAt: dt.nowISOString(),
    });
    await app.stepRepo.create({
      workflowExecutionId: exec.id,
      stepName: "first",
      stepIndex: 0,
      status: "completed",
      attempt: 1,
      maxAttempts: 1,
      result: { ok: true },
      startedAt: dt.nowISOString(),
      completedAt: dt.nowISOString(),
    });
    await app.stepRepo.create({
      workflowExecutionId: exec.id,
      stepName: "late",
      stepIndex: 1,
      status: "pending",
      attempt: 0,
      maxAttempts: 1,
    });

    const provider = alepha.inject(WorkflowProvider);
    await provider.recoverySweep();

    // The sweep must have stamped the wait — not run the step early.
    const late = await waitFor(
      () =>
        app.stepRepo.findMany({
          where: {
            workflowExecutionId: { eq: exec.id },
            stepName: { eq: "late" },
          },
        }),
      (steps) => !!steps[0]?.scheduledAt,
      { label: "lost stamp restored" },
    );
    expect(late[0].status).toBe("pending");
    expect(lateRuns).toBe(0);

    // And the restored wait still delivers.
    await dt.travel([11, "minute"]);
    await waitFor(
      () => app.repo.findById(exec.id),
      (e) => e?.status === "completed",
      { label: "workflow completed after restored delay" },
    );
    expect(lateRuns).toBe(1);
  });

  it("recovery sweep starts a pending workflow whose start dispatch was lost", async ({
    expect,
  }) => {
    let calls = 0;

    class App {
      repo = $repository(workflowExecutions);
      stepRepo = $repository(workflowStepExecutions);
      lost = $workflow({
        schema: z.object({ id: z.text() }),
        steps: [
          {
            name: "only",
            handler: async () => {
              calls++;
              return { ok: true };
            },
          },
        ],
      });
    }

    const alepha = makeApp().with(App);
    await alepha.start();
    const app = alepha.inject(App);
    const dt = alepha.inject(DateTimeProvider);

    const exec = await app.repo.create({
      workflowName: "App.lost",
      status: "pending",
      priority: 2,
      payload: { id: "lost-start" },
      scheduledAt: dt.now().subtract(1, "minute").toISOString(),
    });
    await app.stepRepo.create({
      workflowExecutionId: exec.id,
      stepName: "only",
      stepIndex: 0,
      status: "pending",
      attempt: 0,
      maxAttempts: 1,
    });

    const provider = alepha.inject(WorkflowProvider);
    await provider.recoverySweep();

    await waitFor(
      () => app.repo.findById(exec.id),
      (e) => e?.status === "completed",
      { label: "lost pending workflow completed" },
    );
    expect(calls).toBe(1);
  });
});

// -----------------------------------------------------------------------------------------------------------------

describe("$workflow — timeout sweep", () => {
  it("times out a workflow past its deadline and fails its running step", async ({
    expect,
  }) => {
    class App {
      repo = $repository(workflowExecutions);
      stepRepo = $repository(workflowStepExecutions);
      slow = $workflow({
        schema: z.object({ id: z.text() }),
        onError: "fail",
        steps: [{ name: "only", handler: async () => ({ ok: true }) }],
      });
    }

    const alepha = makeApp().with(App);
    await alepha.start();
    const app = alepha.inject(App);
    const dt = alepha.inject(DateTimeProvider);

    const exec = await app.repo.create({
      workflowName: "App.slow",
      status: "running",
      priority: 2,
      payload: { id: "deadline" },
      startedAt: dt.nowISOString(),
      scheduledAt: dt.nowISOString(),
      deadlineAt: dt.now().subtract(1, "minute").toISOString(),
    });
    await app.stepRepo.create({
      workflowExecutionId: exec.id,
      stepName: "only",
      stepIndex: 0,
      status: "running",
      attempt: 1,
      maxAttempts: 1,
      startedAt: dt.nowISOString(),
    });

    const provider = alepha.inject(WorkflowProvider);
    await provider.timeoutSweep();

    const finalExec = await app.repo.findById(exec.id);
    expect(finalExec?.status).toBe("timed_out");

    const steps = await app.stepRepo.findMany({
      where: { workflowExecutionId: { eq: exec.id } },
    });
    expect(steps[0].status).toBe("failed");
    expect(steps[0].error).toBe("Workflow timed out");
  });
});

// -----------------------------------------------------------------------------------------------------------------

describe("$workflow — dedup race", () => {
  it("concurrent same-key starts resolve to a single execution", async ({
    expect,
  }) => {
    class App {
      repo = $repository(workflowExecutions);
      keyed = $workflow({
        schema: z.object({ id: z.text() }),
        steps: [
          {
            name: "slowish",
            handler: async () => {
              await new Promise((r) => setTimeout(r, 200));
              return { ok: true };
            },
          },
        ],
      });
    }

    const alepha = makeApp().with(App);
    await alepha.start();
    const app = alepha.inject(App);

    const ids = await Promise.all([
      app.keyed.start({ id: "a" }, { key: "race" }),
      app.keyed.start({ id: "b" }, { key: "race" }),
      app.keyed.start({ id: "c" }, { key: "race" }),
      app.keyed.start({ id: "d" }, { key: "race" }),
      app.keyed.start({ id: "e" }, { key: "race" }),
    ]);

    expect(new Set(ids).size).toBe(1);

    const rows = await app.repo.findMany({
      where: { key: { eq: "race" } },
    });
    expect(rows).toHaveLength(1);

    await waitFor(
      () => app.repo.findById(ids[0]),
      (e) => e?.status === "completed",
      { label: "raced workflow completed" },
    );
  });
});
