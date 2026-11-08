import { $inject, Alepha, z } from "alepha";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { CronProvider } from "alepha/scheduler";
import {
  $action,
  $route,
  AlephaServer,
  HttpClient,
  ServerProvider,
} from "alepha/server";
import {
  $subscriber,
  $topic,
  MemoryTopicProvider,
  TopicProvider,
} from "alepha/topic";
import { MemoryTraceProvider } from "alepha/tracing";
import { describe, it } from "vitest";

import {
  $job,
  AlephaApiJobs,
  AlephaApiJobsQueue,
  jobExecutionEntity,
} from "../index.ts";

/**
 * Root spans for background work (#E86): a job run, a queue message, a cron
 * tick and a topic message each open a trace, and a message produced inside
 * a request links back to the span that produced it.
 */
describe("background tracing", () => {
  const waitFor = async (predicate: () => boolean) => {
    for (let i = 0; i < 300; i++) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("waitFor: condition not met");
  };

  it("runs a queued job pushed from a request as one tree, linked to the request", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs)
      .with(AlephaApiJobsQueue)
      .with(AlephaServer);
    let done = false;

    class App {
      http = $inject(HttpClient);
      server = $inject(ServerProvider);
      executions = $repository(jobExecutionEntity);
      upstream = $route({
        method: "GET",
        path: "/upstream",
        handler: () => "ok",
      });
      call = $job({
        name: "tracing.call",
        description: "A job under test.",
        schema: z.object({ v: z.integer() }),
        handler: async () => {
          await this.executions.count();
          await this.http.fetch(`${this.server.hostname}/upstream`);
          done = true;
        },
      });
      trigger = $action({
        method: "POST",
        path: "/trigger",
        handler: async () => {
          await this.call.push({ v: 1 });
        },
      });
    }
    const app = alepha.inject(App);
    const traces = alepha.inject(MemoryTraceProvider);
    await alepha.start();

    await (
      await fetch(`${app.server.hostname}/api/trigger`, { method: "POST" })
    ).text();
    await waitFor(() => done);
    await waitFor(() =>
      traces.spans().some((s) => s.kind === "consumer" && s.ended),
    );

    const action = traces.find("action trigger")!;
    const job = traces.find("job tracing.call")!;
    expect(job).toBeDefined();
    expect(job.attributes).toMatchObject({
      "alepha.job.name": "tracing.call",
      "alepha.job.attempt": expect.any(Number),
    });
    expect(job.attributes["alepha.job.execution_id"]).toBeTypeOf("string");

    // The job runs in a trace of its own...
    expect(job.traceId).not.toBe(action.traceId);
    const tree = traces.trace(job.traceId);
    const root = tree.find((s) => !s.parentSpanId)!;
    expect(root.kind).toBe("consumer");
    expect(root.name.startsWith("queue ")).toBe(true);
    expect(job.parentSpanId).toBe(root.spanId);

    // ... whose root links back to the request that pushed it,
    expect(
      root.links.some(
        (l) => l.traceId === action.traceId && l.spanId === action.spanId,
      ),
    ).toBe(true);

    // ... and that holds its query, its outbound call and the callee's root.
    expect(traces.children(job).map((s) => s.name)).toEqual(
      expect.arrayContaining(["select job_executions"]),
    );
    const client = tree.find((s) => s.kind === "client")!;
    expect(client.parentSpanId).toBe(job.spanId);
    const callee = traces.find("GET /upstream")!;
    expect(callee.traceId).toBe(job.traceId);
    expect(callee.parentSpanId).toBe(client.spanId);

    await alepha.stop();
  });

  it("opens a cron root per tick, with the job run as its child", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaApiJobs);
    class App {
      tick = $job({
        name: "tracing.tick",
        description: "A job under test.",
        cron: "0 0 * * *",
        handler: async () => {},
      });
    }
    alepha.inject(App);
    const traces = alepha.inject(MemoryTraceProvider);
    const cron = alepha.inject(CronProvider);
    await alepha.start();

    await cron.trigger("tracing.tick");

    const root = traces.find("cron tracing.tick")!;
    expect(root).toBeDefined();
    expect(root.parentSpanId).toBeUndefined();
    // The job run, beside the cron claim's own statements.
    const children = traces.children(root).map((s) => s.name);
    expect(children).toContain("job tracing.tick");
    expect(children).toContain("insert job_cron_claims");
    await alepha.stop();
  });

  it("gives each topic message its own context and a consumer root linked to the producer", async ({
    expect,
  }) => {
    const contexts: string[] = [];
    let producerContext: string | undefined;

    class App {
      alepha = $inject(Alepha);
      events = $topic({
        name: "tracing-events",
        schema: { payload: z.object({ id: z.text() }) },
      });
      listener = $subscriber({
        topic: this.events,
        handler: async () => {
          contexts.push(this.alepha.context.get<string>("context")!);
        },
      });
      publish = $action({
        method: "POST",
        path: "/publish",
        handler: async () => {
          producerContext = this.alepha.context.get<string>("context");
          await this.events.publish({ id: "a" });
          await this.events.publish({ id: "b" });
        },
      });
    }
    const alepha = Alepha.create()
      .with({ provide: TopicProvider, use: MemoryTopicProvider })
      .with(AlephaServer);
    alepha.inject(App);
    const traces = alepha.inject(MemoryTraceProvider);
    await alepha.start();

    await (
      await fetch(`${alepha.inject(ServerProvider).hostname}/api/publish`, {
        method: "POST",
      })
    ).text();
    await waitFor(() => contexts.length === 2);
    await waitFor(
      () =>
        traces.spans().filter((s) => s.name === "topic tracing-events")
          .length === 2,
    );

    // Its own unit of work: a correlation id of its own per message.
    expect(new Set(contexts).size).toBe(2);
    expect(contexts).not.toContain(producerContext);

    const action = traces.find("action publish")!;
    const consumers = traces
      .spans()
      .filter((s) => s.name === "topic tracing-events");
    for (const consumer of consumers) {
      expect(consumer.kind).toBe("consumer");
      expect(consumer.parentSpanId).toBeUndefined();
      expect(consumer.traceId).not.toBe(action.traceId);
      expect(consumer.links).toEqual([
        { traceId: action.traceId, spanId: action.spanId },
      ]);
    }
    await alepha.stop();
  });

  it("starts an unlinked trace for a message that carries no traceparent", async ({
    expect,
  }) => {
    let received = false;
    class App {
      events = $topic({
        name: "tracing-plain",
        schema: { payload: z.object({ id: z.text() }) },
      });
      listener = $subscriber({
        topic: this.events,
        handler: async () => {
          received = true;
        },
      });
    }
    const alepha = Alepha.create().with({
      provide: TopicProvider,
      use: MemoryTopicProvider,
    });
    alepha.inject(App);
    const traces = alepha.inject(MemoryTraceProvider);
    await alepha.start();

    await alepha
      .inject(TopicProvider)
      .publish("tracing-plain", JSON.stringify({ payload: { id: "x" } }));
    await waitFor(() => received);
    await waitFor(() => !!traces.find("topic tracing-plain"));

    expect(traces.find("topic tracing-plain")!.links).toEqual([]);
    await alepha.stop();
  });
});
