import { $atom, $inject, Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { LockProvider } from "alepha/lock";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it, vi } from "vitest";

import {
  $workflow,
  AlephaApiWorkflows,
  type WorkflowExecutionEntity,
  WorkflowProvider,
  type WorkflowStep,
  type WorkflowStepExecutionEntity,
  WorkflowTestKit,
  workflowExecutions,
  workflowStepExecutions,
} from "../index.ts";

// -----------------------------------------------------------------------------------------------------------------

// Raised so `waitFor`'s 10_000ms budget expires FIRST and its diagnostic (the
// actual execution row) reaches the reporter. With both at 10_000 vitest won
// every race and reported a bare timeout, which is why the delayed-step
// flakes in this module were characterised by hand twice over.
vi.setConfig({ testTimeout: 30_000 });

/**
 * Poll `fn` until `predicate` returns true, or throw on timeout.
 *
 * The budget must stay UNDER this file's `testTimeout`, which the
 * `vi.setConfig` above raises to 30_000 for exactly that reason. Both used
 * to be 10_000, so vitest's timeout won every race and killed the test
 * before this threw, which meant the message below (the one carrying the
 * actual row) was never printed. Two sessions characterised a parked
 * workflow by hand before anyone noticed the diagnostic existed and was
 * simply unreachable.
 *
 * Raise the ceiling, never lower this floor. Lowering it to 8_000 opened
 * the same gap but also cut every workflow test's tolerance by two seconds,
 * and CI went red on a delayed-step test that had been green at 10_000.
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

  /**
   * `retry()` used to leave `deadlineAt` where the timeout put it: in the
   * past. The retried run went back to `running` under an expired deadline,
   * so the next sweep killed it again before its step could do anything, and
   * retrying a timed-out workflow was a no-op that read as a second failure.
   */
  it("gives a retried timeout a fresh deadline and survives the next sweep", async ({
    expect,
  }) => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    class App {
      repo = $repository(workflowExecutions);
      stepRepo = $repository(workflowStepExecutions);
      slow = $workflow({
        schema: z.object({ id: z.text() }),
        onError: "fail",
        timeout: [10, "minutes"],
        steps: [
          {
            name: "only",
            handler: async () => {
              await gate;
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
    const provider = alepha.inject(WorkflowProvider);

    const exec = await app.repo.create({
      workflowName: "App.slow",
      status: "running",
      priority: 2,
      payload: { id: "retry-deadline" },
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

    await provider.timeoutSweep();
    expect((await app.repo.findById(exec.id))?.status).toBe("timed_out");

    // Not awaited: the handler parks on the gate, so `retry()` only settles
    // once the step is released - which is the whole point, the execution has
    // to still be `running` when the next sweep goes by.
    const retrying = provider.retry(exec.id);

    const retried = await waitFor(
      () => app.repo.findById(exec.id),
      (e) => e?.status === "running",
      { label: "retried workflow running" },
    );
    expect(new Date(retried!.deadlineAt!).getTime()).toBeGreaterThan(
      dt.nowMillis(),
    );

    // The half that actually bit: under the old code this sweep found a
    // `running` execution with an expired deadline and killed it again.
    await provider.timeoutSweep();
    expect((await app.repo.findById(exec.id))?.status).toBe("running");

    release?.();
    await retrying;

    const done = await waitFor(
      () => app.repo.findById(exec.id),
      (e) => e?.status === "completed",
      { label: "retried workflow completed" },
    );
    expect(done?.status).toBe("completed");
  });
});

// -----------------------------------------------------------------------------------------------------------------

describe("$workflow - restart", () => {
  /**
   * A restart is usually clicked by an admin, and it used to call `start()`
   * bare: the new execution captured THEIR ambient atoms and dropped the
   * original's key, tags, priority and triggeredBy on the floor.
   */
  it("takes its metadata and context from the stored row, not from the caller", async ({
    expect,
  }) => {
    class App {
      alepha = $inject(Alepha);
      repo = $repository(workflowExecutions);
      doomed = $workflow({
        schema: z.object({ id: z.text() }),
        context: [specTenantAtom],
        onError: "fail",
        priority: "low",
        tags: ["billing"],
        steps: [
          {
            name: "only",
            handler: async () => {
              throw new Error("boom");
            },
          },
        ],
      });
    }

    const alepha = makeApp().with(App);
    await alepha.start();
    const app = alepha.inject(App);

    alepha.store.set(specTenantAtom, { id: "org-1" });
    const executionId = await app.doomed.start(
      { id: "x" },
      { key: "invoice-42", triggeredBy: "user-1", triggeredByName: "Ada" },
    );

    const original = await waitFor(
      () => app.repo.findById(executionId),
      (e) => e?.status === "failed",
      { label: "workflow failed" },
    );
    // "low", so a restart that recomputed the priority would land on the
    // default 2 and the assertion below would not be about anything.
    expect(original?.priority).toBe(3);

    // The admin who clicks restart carries their own tenant.
    alepha.store.set(specTenantAtom, { id: "org-admin" });
    const newId = await app.doomed.restart(executionId);
    expect(newId).not.toBe(executionId);

    const restarted = await app.repo.findById(newId);
    expect(restarted?.key).toBe("invoice-42");
    expect(restarted?.tags).toEqual(["billing"]);
    expect(restarted?.priority).toBe(3);
    expect(restarted?.triggeredBy).toBe("user-1");
    expect(restarted?.triggeredByName).toBe("Ada");
    expect(restarted?.context).toEqual({
      "alepha.test.workflowTenant": { id: "org-1" },
    });
    expect(restarted?.restartedFrom).toBe(executionId);
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

// -----------------------------------------------------------------------------------------------------------------

describe("$workflow — dedup key semantics", () => {
  it("keeps the key on terminal rows and allows a re-run under the same key", async ({
    expect,
  }) => {
    class App {
      repo = $repository(workflowExecutions);
      keyed = $workflow({
        schema: z.object({ id: z.text() }),
        steps: [
          {
            name: "step1",
            handler: async () => ({ ok: true }),
          },
        ],
      });
    }

    const alepha = makeApp().with(App);
    await alepha.start();
    const app = alepha.inject(App);

    const first = await app.keyed.start({ id: "a" }, { key: "slot-1" });
    await waitFor(
      () => app.repo.findById(first),
      (e) => e?.status === "completed",
      { label: "first keyed run completed" },
    );

    // Terminal rows keep their key: it is the lookup handle for tests and
    // ops. Dedup does not need the clear — the unique index is partial
    // over non-terminal statuses only.
    const done = await app.repo.findById(first);
    expect(done?.key).toBe("slot-1");

    // A re-run under the same key must be a NEW execution, not a dedup hit
    // on the completed row.
    const second = await app.keyed.start({ id: "b" }, { key: "slot-1" });
    expect(second).not.toBe(first);
    await waitFor(
      () => app.repo.findById(second),
      (e) => e?.status === "completed",
      { label: "second keyed run completed" },
    );

    const rows = await app.repo.findMany({
      where: { key: { eq: "slot-1" } },
    });
    expect(rows).toHaveLength(2);
  });

  it("cancelByKey cancels the live keyed execution and no-ops otherwise", async ({
    expect,
  }) => {
    class App {
      repo = $repository(workflowExecutions);
      armed = $workflow({
        schema: z.object({ id: z.text() }),
        steps: [
          {
            name: "step1",
            handler: async () => ({ ok: true }),
          },
        ],
      });
    }

    const alepha = makeApp().with(App);
    await alepha.start();
    const app = alepha.inject(App);

    // Parked far in the future so it stays live (pending) while we disarm.
    const executionId = await app.armed.start(
      { id: "x" },
      { key: "booking-9", delay: [5, "minute"] },
    );

    const cancelled = await app.armed.cancelByKey("booking-9", {
      cancelledByName: "test disarm",
    });
    expect(cancelled).toBe(executionId);

    const row = await app.repo.findById(executionId);
    expect(row?.status).toBe("cancelled");
    expect(row?.cancelledByName).toBe("test disarm");
    // The key survives the terminal transition.
    expect(row?.key).toBe("booking-9");

    // Nothing live under the key anymore: both the same key and an
    // unknown key resolve to null instead of throwing.
    expect(await app.armed.cancelByKey("booking-9")).toBeNull();
    expect(await app.armed.cancelByKey("never-armed")).toBeNull();
  });
});

// -----------------------------------------------------------------------------------------------------------------

const specTenantAtom = $atom({
  name: "alepha.test.workflowTenant",
  schema: z.object({ id: z.text() }).optional(),
});

describe("$workflow — context propagation", () => {
  it("restores captured atoms in steps dispatched by the sweep, shadowing the ambient value", async ({
    expect,
  }) => {
    const seen: Array<{ id: string } | undefined> = [];

    class App {
      alepha = $inject(Alepha);
      repo = $repository(workflowExecutions);
      stepRepo = $repository(workflowStepExecutions);
      scoped = $workflow({
        schema: z.object({ id: z.text() }),
        context: [specTenantAtom],
        steps: [
          {
            name: "observe",
            handler: async () => {
              seen.push(this.alepha.store.get(specTenantAtom));
              return { ok: true };
            },
          },
        ],
      });
    }

    const alepha = makeApp().with(App);
    await alepha.start();
    const app = alepha.inject(App);

    // The tenant is ambient when the workflow starts...
    alepha.store.set(specTenantAtom, { id: "org-1" });
    const executionId = await app.scoped.start(
      { id: "x" },
      { delay: [5, "minute"] },
    );

    const row = await app.repo.findById(executionId);
    expect(row?.context).toEqual({
      "alepha.test.workflowTenant": { id: "org-1" },
    });

    // ...and by the time the step actually runs — on a sweep dispatch,
    // standing in for "another process after a crash" — the ambient value
    // has moved on. The step must see the snapshot, not the ambient.
    alepha.store.set(specTenantAtom, { id: "org-other" });
    await alepha.inject(DateTimeProvider).travel([6, "minute"]);

    await waitFor(
      async () => {
        await alepha.inject(WorkflowProvider).recoverySweep();
        return app.repo.findById(executionId);
      },
      (e) => e?.status === "completed",
      { label: "scoped workflow completed", interval: 50 },
    );

    expect(seen).toEqual([{ id: "org-1" }]);
    // The restore died with the step's scope: the ambient value is intact.
    expect(alepha.store.get(specTenantAtom)).toEqual({ id: "org-other" });
  });

  it("restores captured atoms in compensation handlers", async ({ expect }) => {
    const compensationSaw: Array<{ id: string } | undefined> = [];

    class App {
      alepha = $inject(Alepha);
      repo = $repository(workflowExecutions);
      stepRepo = $repository(workflowStepExecutions);
      saga = $workflow({
        schema: z.object({ id: z.text() }),
        context: [specTenantAtom],
        onError: "compensate",
        steps: [
          {
            name: "reserve",
            handler: async () => ({ ok: true }),
            compensate: async () => {
              compensationSaw.push(this.alepha.store.get(specTenantAtom));
            },
          },
          {
            name: "explode",
            delay: [1, "minute"],
            handler: async () => {
              throw new Error("boom");
            },
          },
        ],
      });
    }

    const alepha = makeApp().with(App);
    await alepha.start();
    const app = alepha.inject(App);

    alepha.store.set(specTenantAtom, { id: "org-a" });
    const executionId = await app.saga.start({ id: "y" });

    // Wait for the delayed second step to be parked, then move the
    // ambient tenant — compensation must still see the snapshot.
    await waitFor(
      () =>
        app.stepRepo.findOne({
          where: {
            workflowExecutionId: { eq: executionId },
            stepName: { eq: "explode" },
          },
        }),
      (s) => s?.status === "pending" && Boolean(s?.scheduledAt),
      { label: "second step parked" },
    );
    alepha.store.set(specTenantAtom, { id: "org-b" });
    await alepha.inject(DateTimeProvider).travel([2, "minute"]);

    await waitFor(
      async () => {
        await alepha.inject(WorkflowProvider).recoverySweep();
        return app.repo.findById(executionId);
      },
      (e) => e?.status === "compensated",
      { label: "saga compensated", interval: 50 },
    );

    expect(compensationSaw).toEqual([{ id: "org-a" }]);
  });

  it("stores no context and keeps ambient reads working when the option is absent", async ({
    expect,
  }) => {
    const seen: Array<{ id: string } | undefined> = [];

    class App {
      alepha = $inject(Alepha);
      repo = $repository(workflowExecutions);
      plain = $workflow({
        schema: z.object({ id: z.text() }),
        steps: [
          {
            name: "observe",
            handler: async () => {
              seen.push(this.alepha.store.get(specTenantAtom));
              return { ok: true };
            },
          },
        ],
      });
    }

    const alepha = makeApp().with(App);
    await alepha.start();
    const app = alepha.inject(App);

    alepha.store.set(specTenantAtom, { id: "org-ambient" });
    const executionId = await app.plain.start({ id: "z" });

    await waitFor(
      () => app.repo.findById(executionId),
      (e) => e?.status === "completed",
      { label: "plain workflow completed" },
    );

    const row = await app.repo.findById(executionId);
    // Nothing captured — and the step still reads the ambient app-level
    // value through the scope chain, exactly as before this feature.
    expect(row?.context ?? null).toBeNull();
    expect(seen).toEqual([{ id: "org-ambient" }]);
  });
});

// -----------------------------------------------------------------------------------------------------------------

describe("$workflow — repeat steps", () => {
  /**
   * Parked 2026-08-18 with the retry test in `$workflow.spec.ts` (same
   * shape: a step falls due and is never picked up), un-parked 2026-09-01.
   *
   * The shape had a cause, and it is fixed: the re-park stamped the step row
   * and then pushed a dispatch scheduled from a SECOND clock read, so a
   * `travel()` landing between the two (this loop polls for the stamp, then
   * travels) left the outbox row due ten minutes past the travelled clock.
   * The recovery sweep rescued it whenever the travel happened to cross a
   * quarter-hour sweep tick, which is why it failed only some of the time and why
   * probes seemed to hide it. `$workflow-travel-race.spec.ts` pins that
   * window deterministically.
   *
   * Park before you travel still holds: a `travel()` issued before the next
   * step's `scheduledAt` has been written moves the clock past a timer that
   * does not exist yet, and the workflow then waits forever. Wait for the
   * stamp, then travel.
   */
  it("repeats durably until the handler stops asking, then falls through", async ({
    expect,
  }) => {
    const runs: number[] = [];

    class App {
      repo = $repository(workflowExecutions);
      stepRepo = $repository(workflowStepExecutions);
      cascade = $workflow({
        schema: z.object({ id: z.text() }),
        steps: [
          {
            name: "offer",
            repeat: { delay: [10, "minute"] },
            handler: async ({ context }) => {
              runs.push(context.iteration);
              if (runs.length < 3) {
                return { repeat: true, round: context.iteration };
              }
              return { done: true };
            },
          },
          {
            name: "after",
            handler: async () => ({ ok: true }),
          },
        ],
      });
    }

    const alepha = makeApp().with(App);
    await alepha.start();
    const app = alepha.inject(App);
    const dt = alepha.inject(DateTimeProvider);

    const executionId = await app.cascade.start({ id: "loop" });

    for (let round = 1; round <= 2; round++) {
      // Park-before-travel: the re-park bumps `iteration` and stamps the
      // next not-before time in ONE write — wait for it.
      await waitFor(
        () =>
          app.stepRepo.findOne({
            where: {
              workflowExecutionId: { eq: executionId },
              stepName: { eq: "offer" },
            },
          }),
        (s) =>
          s?.status === "pending" &&
          s?.iteration === round &&
          Boolean(s?.scheduledAt),
        { label: `iteration ${round} parked` },
      );
      await dt.travel([11, "minute"]);
      await waitFor(
        async () => {
          await alepha.inject(WorkflowProvider).recoverySweep();
          return runs.length;
        },
        (n) => n > round,
        { label: `iteration ${round} ran`, interval: 50 },
      );
    }

    await waitFor(
      () => app.repo.findById(executionId),
      (e) => e?.status === "completed",
      { label: "workflow completed after loop" },
    );

    expect(runs).toEqual([0, 1, 2]);
    const step = await app.stepRepo.findOne({
      where: {
        workflowExecutionId: { eq: executionId },
        stepName: { eq: "offer" },
      },
    });
    expect(step?.status).toBe("completed");
    expect(step?.iteration).toBe(2);
    // The FINAL verdict is the step's result — the repeat signal never
    // leaks into downstream results.
    expect(step?.result).toEqual({ done: true });
  });

  it("fails the step when it still asks to repeat past the limit", async ({
    expect,
  }) => {
    class App {
      repo = $repository(workflowExecutions);
      stepRepo = $repository(workflowStepExecutions);
      stubborn = $workflow({
        schema: z.object({ id: z.text() }),
        onError: "fail",
        steps: [
          {
            name: "again",
            repeat: { delay: [1, "minute"], limit: 2 },
            handler: async () => ({ repeat: true }),
          },
        ],
      });
    }

    const alepha = makeApp().with(App);
    await alepha.start();
    const app = alepha.inject(App);
    const dt = alepha.inject(DateTimeProvider);

    const executionId = await app.stubborn.start({ id: "cap" });

    // Run 1 of 2 parks the second run…
    await waitFor(
      () =>
        app.stepRepo.findOne({
          where: {
            workflowExecutionId: { eq: executionId },
            stepName: { eq: "again" },
          },
        }),
      (s) => s?.status === "pending" && s?.iteration === 1,
      { label: "second run parked" },
    );
    await dt.travel([2, "minute"]);

    // …which asks to repeat AGAIN — over the limit of 2 total runs.
    await waitFor(
      async () => {
        await alepha.inject(WorkflowProvider).recoverySweep();
        return app.repo.findById(executionId);
      },
      (e) => e?.status === "failed",
      { label: "workflow failed on repeat limit", interval: 50 },
    );

    const step = await app.stepRepo.findOne({
      where: {
        workflowExecutionId: { eq: executionId },
        stepName: { eq: "again" },
      },
    });
    expect(step?.status).toBe("failed");
    expect(step?.error).toContain("repeat.limit");
    const exec = await app.repo.findById(executionId);
    expect(exec?.errorStep).toBe("again");
  });

  it("resumes a lost iteration from the row alone, counter intact", async ({
    expect,
  }) => {
    const runs: number[] = [];

    class App {
      repo = $repository(workflowExecutions);
      stepRepo = $repository(workflowStepExecutions);
      durable = $workflow({
        schema: z.object({ id: z.text() }),
        steps: [
          {
            name: "tick",
            repeat: { delay: [30, "minute"] },
            handler: async ({ context }) => {
              runs.push(context.iteration);
              if (context.iteration >= 1) {
                return { done: true };
              }
              return { repeat: true };
            },
          },
        ],
      });
    }

    const alepha = makeApp().with(App);
    await alepha.start();
    const app = alepha.inject(App);

    const executionId = await app.durable.start({ id: "crash" });

    const parked = await waitFor(
      () =>
        app.stepRepo.findOne({
          where: {
            workflowExecutionId: { eq: executionId },
            stepName: { eq: "tick" },
          },
        }),
      (s) => s?.status === "pending" && s?.iteration === 1,
      { label: "second iteration parked" },
    );

    // Simulate the process dying and the outbox delivery being lost: the
    // stamp is now due, and NOTHING but the row remembers the iteration.
    await app.stepRepo.updateById(parked!.id, {
      scheduledAt: new Date(Date.now() - 1000).toISOString(),
    });

    await waitFor(
      async () => {
        await alepha.inject(WorkflowProvider).recoverySweep();
        return app.repo.findById(executionId);
      },
      (e) => e?.status === "completed",
      { label: "resumed after simulated crash", interval: 50 },
    );

    expect(runs).toEqual([0, 1]);
  });
});

// -----------------------------------------------------------------------------------------------------------------

describe("$workflow — startEach fan-out and WorkflowTestKit", () => {
  it("starts one keyed execution per item and dedups a re-drive", async ({
    expect,
  }) => {
    class App {
      repo = $repository(workflowExecutions);
      perItem = $workflow({
        schema: z.object({ shareId: z.text() }),
        steps: [
          {
            name: "resolve",
            handler: async () => ({ ok: true }),
          },
        ],
      });
    }

    const alepha = makeApp().with(App);
    await alepha.start();
    const app = alepha.inject(App);
    const kit = alepha.inject(WorkflowTestKit);

    const shares = ["s1", "s2", "s3"];
    // Delayed so all three stay LIVE while we re-drive the fan-out.
    const ids = await app.perItem.startEach(shares, (shareId) => ({
      payload: { shareId },
      key: shareId,
      delay: [5, "minute"] as const,
    }));
    expect(new Set(ids).size).toBe(3);

    // Re-driving the same fan-out (the crash-recovery move) must dedup
    // onto the live executions, not double them.
    const again = await app.perItem.startEach(shares, (shareId) => ({
      payload: { shareId },
      key: shareId,
      delay: [5, "minute"] as const,
    }));
    expect(again.sort()).toEqual([...ids].sort());
    const rows = await app.repo.findMany({
      where: { workflowName: { eq: "App.perItem" } },
    });
    expect(rows).toHaveLength(3);

    // Each item is individually parked; release and settle them via the
    // kit — park-before-travel and the post-travel nudge in one place.
    for (const id of ids) {
      await kit.awaitParked(id, "resolve");
    }
    await alepha.inject(DateTimeProvider).travel([6, "minute"]);
    for (const id of ids) {
      await kit.awaitStatus(id, "completed");
    }

    const done = await kit.findByPayload("App.perItem", { shareId: "s2" });
    expect(done?.status).toBe("completed");
  });
});

// -----------------------------------------------------------------------------------------------------------------

/**
 * Grants every lock, always.
 *
 * Models the runtime the step claim actually has to survive: on Cloudflare
 * Workers, and on Node without `alepha/lock/redis`, `LockProvider` is the
 * per-isolate `MemoryLockProvider`, so two isolates each hold their own and
 * neither excludes the other. In one process that is indistinguishable from
 * a lock that never refuses.
 */
class UncontendedLockProvider extends LockProvider {
  protected readonly store: Record<string, string> = {};

  public async set(key: string, value: string): Promise<string> {
    this.store[key] = value;
    return value;
  }

  public async get(key: string): Promise<string | undefined> {
    return this.store[key];
  }

  public async del(...keys: string[]): Promise<void> {
    for (const key of keys) delete this.store[key];
  }
}

/**
 * Holds every dispatch at the seam between "I read the step and it said
 * pending" and "I claim it", then releases them together.
 *
 * The window is otherwise invisible from one process: two `processStep`
 * calls awaiting the same database do not naturally interleave across it,
 * so a test that just fires two of them passes against the unguarded
 * `updateById` and proves nothing. Two isolates DO sit in that window
 * simultaneously — each has read `pending`, neither has written — and
 * this gate is the only way to put a single-process test there.
 */
class GatedWorkflowProvider extends WorkflowProvider {
  public gate?: Promise<void>;
  public arrivals = 0;

  protected override async executeHandlerStep(
    workflow: WorkflowExecutionEntity,
    stepExec: WorkflowStepExecutionEntity,
    stepDef: WorkflowStep,
  ): Promise<void> {
    this.arrivals++;
    if (this.gate) await this.gate;
    return super.executeHandlerStep(workflow, stepExec, stepDef);
  }
}

describe("$workflow — the step claim is atomic", () => {
  it("runs the handler exactly once when two dispatches race one pending step", async ({
    expect,
  }) => {
    let calls = 0;

    class App {
      stepRepo = $repository(workflowStepExecutions);
      raced = $workflow({
        schema: z.object({ id: z.text() }),
        steps: [
          {
            name: "only",
            handler: async () => {
              calls++;
              await new Promise((r) => setTimeout(r, 20));
              return { ok: true };
            },
          },
        ],
      });
    }

    const alepha = Alepha.create()
      .with({ provide: LockProvider, use: UncontendedLockProvider })
      .with({ provide: WorkflowProvider, use: GatedWorkflowProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiWorkflows)
      .with(App);
    await alepha.start();

    const app = alepha.inject(App);
    const provider = alepha.inject(GatedWorkflowProvider);

    // Swallow the automatic first dispatch so the step is left `pending`
    // and we own both of the dispatches that race for it.
    provider.stepDispatch = async () => {};

    const workflowId = await app.raced.start({ id: "a" });

    let release!: () => void;
    provider.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const both = Promise.all([
      provider.processStep(workflowId, "only"),
      provider.processStep(workflowId, "only"),
    ]);

    // Both have read the step and seen `pending`; neither has written.
    await waitFor(
      () => provider.arrivals,
      (n) => n === 2,
      { label: "both dispatches parked before the claim" },
    );
    release();
    await both;

    expect(calls).toBe(1);

    const steps = await app.stepRepo.findMany({
      where: { workflowExecutionId: { eq: workflowId } },
    });
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("completed");
    // The loser must not have spent an attempt either.
    expect(steps[0].attempt).toBe(1);
  });

  /**
   * Both orderings, in one test, on purpose.
   *
   * `compensate()` takes no lock of its own and is reachable from four
   * places at once (a step failure, `cancel({ compensate })`, the recovery
   * sweep, the admin endpoint), so the two callers can arrive in either
   * order — and the outcome must not depend on which:
   *
   * - `simultaneous`: both have read the execution, neither has claimed it.
   *   The claim must let exactly one through, or both run every
   *   compensation handler.
   * - `staggered`: the second arrives after the first has already written
   *   `compensating`. The loser must return quietly, not throw.
   *
   * `staggered` is the case that broke CI. The old guard read the status,
   * compared it and only then wrote, so the second caller's read landed
   * after the first caller's write and it threw `Cannot compensate workflow
   * in 'compensating' status`. It passed locally because two `compensate()`
   * calls awaiting the same database do not naturally interleave across
   * that window; on a loaded runner they do. A 25ms stagger reproduced it
   * every time.
   */
  for (const arrival of ["simultaneous", "staggered"] as const) {
    it(`compensates each step exactly once when two compensations arrive ${arrival}`, async ({
      expect,
    }) => {
      let compensations = 0;

      class App {
        repo = $repository(workflowExecutions);
        stepRepo = $repository(workflowStepExecutions);
        undoable = $workflow({
          schema: z.object({ id: z.text() }),
          steps: [
            {
              name: "charge",
              handler: async () => ({ ok: true }),
              compensate: async () => {
                compensations++;
                await new Promise((r) => setTimeout(r, 20));
              },
            },
          ],
        });
      }

      const alepha = Alepha.create()
        .with({ provide: LockProvider, use: UncontendedLockProvider })
        .with(AlephaOrmPostgres)
        .with(AlephaApiWorkflows)
        .with(App);
      await alepha.start();

      const app = alepha.inject(App);
      const provider = alepha.inject(WorkflowProvider);

      const workflowId = await app.undoable.start({ id: "a" });
      await waitFor(
        () => app.repo.findById(workflowId),
        (row) => row?.status === "completed",
        { label: "workflow completed" },
      );

      await app.repo.updateById(workflowId, { status: "failed" });

      const first = provider.compensate(workflowId);
      if (arrival === "staggered") {
        // Long enough for the winner to have claimed the execution and be
        // inside its compensation handler.
        await new Promise((r) => setTimeout(r, 25));
      }
      await Promise.all([first, provider.compensate(workflowId)]);

      expect(compensations).toBe(1);
      const steps = await app.stepRepo.findMany({
        where: { workflowExecutionId: { eq: workflowId } },
      });
      expect(steps[0].status).toBe("compensated");
      expect((await app.repo.findById(workflowId))?.status).toBe("compensated");
    });
  }

  it("lets the loser of a cancel race return quietly, not throw", async ({
    expect,
  }) => {
    class App {
      repo = $repository(workflowExecutions);
      slow = $workflow({
        schema: z.object({ id: z.text() }),
        steps: [
          {
            name: "wait",
            handler: async () => {
              await new Promise((r) => setTimeout(r, 200));
              return { ok: true };
            },
          },
        ],
      });
    }

    const alepha = Alepha.create()
      .with({ provide: LockProvider, use: UncontendedLockProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiWorkflows)
      .with(App);
    await alepha.start();

    const app = alepha.inject(App);
    const provider = alepha.inject(WorkflowProvider);

    const workflowId = await app.slow.start({ id: "a" });
    await waitFor(
      () => app.repo.findById(workflowId),
      (row) => row?.status === "running",
      { label: "workflow running" },
    );

    // Two admins clicking Cancel, or a listener racing an admin. The second
    // one used to get `Cannot cancel workflow in 'cancelled' status` — which
    // is why `cancelByKey` carries a try/catch that re-reads the row.
    const first = provider.cancel(workflowId);
    await new Promise((r) => setTimeout(r, 25));
    await Promise.all([first, provider.cancel(workflowId)]);

    expect((await app.repo.findById(workflowId))?.status).toBe("cancelled");
  });
});
