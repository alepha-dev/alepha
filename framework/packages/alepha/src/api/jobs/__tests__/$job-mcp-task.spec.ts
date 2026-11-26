import { AlephaError, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import {
  $tool,
  AlephaMcp,
  McpForbiddenError,
  McpTaskNotWaitingError,
  McpTaskStore,
} from "alepha/mcp";
import { $repository } from "alepha/orm";
import { describe, it } from "vitest";

import {
  $job,
  JobInputNotAwaitedError,
  JobMcpTaskStore,
  JobProvider,
  jobExecutionEntity,
} from "../index.ts";
import { jobStepsDialects } from "./jobStepsDialects.ts";

/**
 * What an MCP task needs of `$job` (#Q4337): the `result` column, the
 * `expiresAt` retention floor, the `input` step kind with `answerInput`, and
 * the `$job`-backed `McpTaskStore`.
 */

async function waitFor<T>(
  fn: () => Promise<T> | T,
  predicate: (v: T) => boolean,
  { timeout = 5000, interval = 10, label = "condition" } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  let last: T = await fn();
  while (Date.now() < deadline) {
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, interval));
    last = await fn();
  }
  if (predicate(last)) return last;
  throw new AlephaError(
    `waitFor: ${label} not met within ${timeout}ms; last value: ${JSON.stringify(last)}`,
  );
}

class TrimmingJobProvider extends JobProvider {
  public testTrim = this.trimRingBuffers.bind(this);
}

const idSchema = z.object({ id: z.text() });

describe.each(jobStepsDialects)("$job for MCP tasks on $name", (dialect) => {
  it("keeps the handler's result for a job that asks, and null for one that does not", async ({
    expect,
  }) => {
    const alepha = dialect.create();
    class App {
      executions = $repository(jobExecutionEntity);
      kept = $job({
        name: "result.kept",
        description: "Keeps its result.",
        schema: idSchema,
        keepResult: true,
        retention: { ok: { last: 10 } },
        handler: async ({ payload }) => ({ echo: payload.id, n: [1, 2] }),
      });
      plain = $job({
        name: "result.plain",
        description: "Keeps nothing.",
        schema: idSchema,
        retention: { ok: { last: 10 } },
        handler: async () => ({ ignored: true }),
      });
    }
    const app = alepha.inject(App);
    await dialect.start(alepha);

    const kept = await app.kept.push({ id: "a" });
    const plain = await app.plain.push({ id: "b" });

    const row = await waitFor(
      () => app.executions.findById(kept),
      (r) => r?.status === "ok",
      { label: "kept ok" },
    );
    expect(row?.result).toEqual({ echo: "a", n: [1, 2] });
    const other = await waitFor(
      () => app.executions.findById(plain),
      (r) => r?.status === "ok",
      { label: "plain ok" },
    );
    expect(other?.result ?? null).toBe(null);
    await alepha.stop();
  });

  it("keeps a row with retention ok: false until its expiresAt, through the trim, then lets it go", async ({
    expect,
  }) => {
    const alepha = dialect.create((it) =>
      it.with({ provide: JobProvider, use: TrimmingJobProvider }),
    );
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        name: "floor.ok",
        description: "Records no success.",
        schema: idSchema,
        keepResult: true,
        retention: { ok: false },
        handler: async () => "done",
      });
    }
    const app = alepha.inject(App);
    await dialect.start(alepha);
    const dt = alepha.inject(DateTimeProvider);
    const jobs = alepha.inject(TrimmingJobProvider);

    const floored = await app.work.push(
      { id: "a" },
      { expiresAt: dt.now().add(1, "hour").toDate() },
    );
    const bare = await app.work.push({ id: "b" });

    const row = await waitFor(
      () => app.executions.findById(floored),
      (r) => r?.status === "ok",
      { label: "floored row kept as ok" },
    );
    expect(row?.result).toBe("done");
    await waitFor(
      () => app.executions.findById(bare).catch(() => undefined),
      (r) => !r,
      { label: "bare row deleted at success" },
    );

    await jobs.testTrim();
    expect((await app.executions.findById(floored))?.status).toBe("ok");

    await dt.travel([61, "minute"]);
    await jobs.testTrim();
    expect(
      await app.executions.findById(floored).catch(() => undefined),
    ).toBeFalsy();
    await alepha.stop();
  });

  it("parks on two inputs in turn, resumes on each answer, and refuses an answer when not parked", async ({
    expect,
  }) => {
    const alepha = dialect.create();
    const passes: string[] = [];
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        name: "input.two",
        description: "Asks two questions.",
        schema: idSchema,
        keepResult: true,
        retention: { ok: { last: 10 } },
        handler: async ({ step }) => {
          const until = new Date(Date.parse("2100-01-01T00:00:00.000Z"));
          passes.push("start");
          const a = await step.input("input.e0", { e0: { q: "name?" } }, until);
          const b = await step.input("input.e1", { e1: { q: "sure?" } }, until);
          return { a: a.e0, b: b.e1 };
        },
      });
    }
    const app = alepha.inject(App);
    await dialect.start(alepha);
    const jobs = alepha.inject(JobProvider);

    const id = await app.work.push({ id: "x" });
    const first = await waitFor(
      () => app.executions.findById(id),
      (r) => r?.status === "scheduled" && !!r.steps?.["input.e0"],
      { label: "parked on e0" },
    );
    expect(first?.steps?.["input.e0"]).toMatchObject({
      requests: { e0: { q: "name?" } },
      until: "2100-01-01T00:00:00.000Z",
    });
    expect(first?.steps?.["input.e0"]?.answers).toBeUndefined();
    expect(first?.scheduledAt).toBe("2100-01-01T00:00:00.000Z");

    await expect(jobs.answerInput(id, "input.e1", { e1: 1 })).rejects.toThrow(
      JobInputNotAwaitedError,
    );

    await jobs.answerInput(id, "input.e0", { e0: "Ada" });
    await expect(
      jobs.answerInput(id, "input.e0", { e0: "again" }),
    ).rejects.toThrow(JobInputNotAwaitedError);

    const second = await waitFor(
      () => app.executions.findById(id),
      (r) => r?.status === "scheduled" && !!r.steps?.["input.e1"],
      { label: "parked on e1" },
    );
    expect(second?.steps?.["input.e0"]?.answers).toEqual({ e0: "Ada" });

    await jobs.answerInput(id, "input.e1", { e1: true });
    const done = await waitFor(
      () => app.executions.findById(id),
      (r) => r?.status === "ok",
      { label: "finished" },
    );
    expect(done?.result).toEqual({ a: "Ada", b: true });
    expect(passes).toHaveLength(3);

    await expect(jobs.answerInput(id, "input.e1", { e1: 2 })).rejects.toThrow(
      JobInputNotAwaitedError,
    );
    await alepha.stop();
  });

  it("fails an input nobody answered by its until, without a retry", async ({
    expect,
  }) => {
    const alepha = dialect.create();
    let passes = 0;
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        name: "input.expires",
        description: "Waits ten minutes for an answer.",
        schema: z.object({ until: z.text() }),
        retry: {
          retries: 3,
          backoff: { initial: [5, "millisecond"], jitter: false },
        },
        handler: async ({ payload, step }) => {
          passes++;
          await step.input("input.e0", { e0: {} }, new Date(payload.until));
        },
      });
    }
    const app = alepha.inject(App);
    await dialect.start(alepha);
    const dt = alepha.inject(DateTimeProvider);

    const id = await app.work.push({
      until: dt.now().add(10, "minute").toISOString(),
    });
    await waitFor(
      () => app.executions.findById(id),
      (r) => r?.status === "scheduled" && !!r.steps?.["input.e0"],
      { label: "parked" },
    );

    await dt.travel([11, "minute"]);
    const dead = await waitFor(
      () => app.executions.findById(id),
      (r) => r?.status === "error",
      { label: "expired" },
    );
    expect(dead?.error).toContain("waited for input 'input.e0'");
    expect(passes).toBe(2);
    await alepha.stop();
  });

  describe("JobMcpTaskStore", () => {
    const runs = { survey: 0 };
    class TaskTools {
      survey = $tool({
        description: "Asks two questions, then answers",
        handler: async ({ context }) => {
          runs.survey++;
          const name = await context!.elicit!({
            message: "Name?",
            schema: z.object({ name: z.text() }),
          });
          const sure = await context!.elicit!({
            message: "Sure?",
            schema: z.object({ ok: z.boolean() }),
          });
          return `${(name as any).content?.name}:${(sure as any).content?.ok}`;
        },
      });

      denied = $tool({
        description: "Refuses",
        handler: async () => {
          throw new McpForbiddenError("No");
        },
      });
    }

    const boot = async () => {
      const alepha = dialect
        .create()
        .with(AlephaMcp)
        .with({ provide: McpTaskStore, use: JobMcpTaskStore })
        .with(TaskTools);
      await dialect.start(alepha);
      return { alepha, store: alepha.inject(McpTaskStore) };
    };

    const init = (tool: string) => ({
      tool,
      arguments: {},
      clientKey: "client-a",
      elicitation: { form: {} },
      ttlMs: 3_600_000,
    });

    it("maps a run to working, input_required with its requests, then completed with the tool's result", async ({
      expect,
    }) => {
      const { alepha, store } = await boot();

      runs.survey = 0;
      const created = await store.create(init("survey"));
      expect(created).toMatchObject({
        clientKey: "client-a",
        status: "working",
        ttlMs: 3_600_000,
      });

      const asking = await waitFor(
        () => store.get(created.id),
        (t) => t?.status === "input_required",
        { label: "first question" },
      );
      expect(asking?.inputRequests).toEqual({
        e0: {
          method: "elicitation/create",
          params: expect.objectContaining({ mode: "form", message: "Name?" }),
        },
      });

      // Nothing it waits on: refused, not woken.
      await expect(store.answer(created.id, { stray: 1 })).rejects.toThrow(
        "answers none of the task's input requests",
      );
      await store.answer(created.id, {
        e0: { action: "accept", content: { name: "Ada" } },
        stray: 1,
      });
      const again = await waitFor(
        () => store.get(created.id),
        (t) => t?.status === "input_required" && !!t.inputRequests?.e1,
        { label: "second question" },
      );
      expect(Object.keys(again!.inputRequests!)).toEqual(["e1"]);

      await store.answer(created.id, {
        e1: { action: "accept", content: { ok: true } },
      });
      const done = await waitFor(
        () => store.get(created.id),
        (t) => t?.status === "completed",
        { label: "completed" },
      );
      expect(done?.result).toEqual({
        content: [{ type: "text", text: "Ada:true" }],
      });
      // One run per pass: asked e0, asked e1, answered.
      expect(runs.survey).toBe(3);
      await expect(store.answer(created.id, {})).rejects.toThrow(
        McpTaskNotWaitingError,
      );
      await alepha.stop();
    });

    it("maps a refused call to failed, a cancel to cancelled, an unknown id to nothing", async ({
      expect,
    }) => {
      const { alepha, store } = await boot();

      const denied = await store.create(init("denied"));
      const failed = await waitFor(
        () => store.get(denied.id),
        (t) => t?.status === "failed",
        { label: "failed" },
      );
      expect(failed?.error).toEqual({ code: -32603, message: "No" });

      const waiting = await store.create(init("survey"));
      await waitFor(
        () => store.get(waiting.id),
        (t) => t?.status === "input_required",
        { label: "waiting" },
      );
      expect(await store.cancel(waiting.id)).toBe(true);
      expect((await store.get(waiting.id))?.status).toBe("cancelled");

      expect(await store.get("not-a-task")).toBeUndefined();
      expect(
        await store.get("00000000-0000-4000-8000-000000000000"),
      ).toBeUndefined();
      expect(await store.cancel("00000000-0000-4000-8000-000000000000")).toBe(
        false,
      );
      await alepha.stop();
    });
  });
});
