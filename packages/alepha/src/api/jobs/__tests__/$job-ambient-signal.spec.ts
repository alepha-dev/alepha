import { $hook, $inject, Alepha, z } from "alepha";
import { $tool, AlephaMcp, McpServerProvider } from "alepha/mcp";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import {
  MemoryQueueProvider,
  QueueCodec,
  QueueProvider,
  queueWorkerOptions,
  WorkerProvider,
} from "alepha/queue";
import { CronProvider } from "alepha/scheduler";
import {
  $route,
  AlephaServer,
  HttpClient,
  ServerProvider,
} from "alepha/server";
import { describe, it } from "vitest";

import {
  $job,
  AlephaApiJobs,
  AlephaApiJobsQueue,
  jobExecutionEntity,
} from "../index.ts";

/**
 * Jobs, queue messages, cron ticks and MCP tool calls each run under their
 * own signal as the ambient one (#E85), so what they call inherits it.
 */
describe("ambient signal of background work", () => {
  const waitFor = async (predicate: () => Promise<boolean> | boolean) => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("waitFor: condition not met");
  };

  describe("$job", () => {
    it("gives the handler its run's signal as the ambient one, the same object", async ({
      expect,
    }) => {
      const alepha = Alepha.create()
        .with(AlephaOrmPostgres)
        .with(AlephaApiJobs)
        .with(AlephaApiJobsQueue);
      let same: boolean | undefined;

      class App {
        alepha = $inject(Alepha);
        tick = $job({
          name: "ambient.tick",
          description: "A job under test.",
          cron: "0 0 * * *",
          handler: async ({ signal }) => {
            same = signal === this.alepha.context.signal;
          },
        });
      }
      const app = alepha.inject(App);
      await alepha.start();

      await app.tick.trigger();
      expect(same).toBe(true);
    });

    it("aborts the outbound fetch of a cancelled job", async ({ expect }) => {
      const alepha = Alepha.create()
        .with(AlephaOrmPostgres)
        .with(AlephaApiJobs)
        .with(AlephaApiJobsQueue)
        .with(AlephaServer);
      let upstreamLeft = false;
      let reached = false;

      class App {
        http = $inject(HttpClient);
        server = $inject(ServerProvider);
        executions = $repository(jobExecutionEntity);
        upstream = $route({
          method: "POST",
          path: "/upstream",
          handler: async ({ signal }) => {
            reached = true;
            await new Promise((resolve) => {
              signal.addEventListener("abort", resolve, { once: true });
            });
            upstreamLeft = true;
            return "late";
          },
        });
        call = $job({
          name: "ambient.call",
          description: "A job under test.",
          schema: z.object({ v: z.integer() }),
          handler: async () => {
            // No signal passed: the run's is inherited.
            await this.http.fetch(`${this.server.hostname}/upstream`, {
              method: "POST",
            });
          },
        });
      }
      const app = alepha.inject(App);
      await alepha.start();

      const id = await app.call.push({ v: 1 });
      await waitFor(() => reached);
      await app.call.cancel(id);

      await waitFor(() => upstreamLeft);
      expect(upstreamLeft).toBe(true);
    });
  });

  describe("queue messages", () => {
    const schema = z.object({ n: z.integer() });
    const queueApp = (handler: (alepha: Alepha) => Promise<void>) => {
      const alepha = Alepha.create();
      alepha.store.mut(queueWorkerOptions, () => ({
        concurrency: 1,
        interval: 10,
        maxInterval: 100,
        drainTimeout: 50,
      }));
      class Consumer {
        protected readonly queue = $inject(QueueProvider);
        protected readonly worker = $inject(WorkerProvider);
        protected readonly registration = $hook({
          on: "start",
          handler: () => {
            this.worker.register({
              name: "ambient",
              schema,
              provider: this.queue,
              handler: () => handler(alepha),
            });
          },
        });
      }
      alepha
        .with({ provide: QueueProvider, use: MemoryQueueProvider })
        .with(Consumer);
      // Resolved before start, so the container lock does not refuse them.
      const queue = alepha.inject(QueueProvider);
      const codec = alepha.inject(QueueCodec);
      const worker = alepha.inject(WorkerProvider);
      const send = async () => {
        await queue.push("ambient", codec.encode(schema, { n: 1 }));
        worker.wakeUp();
      };
      return { alepha, send, worker };
    };

    it("gives each message its own signal, which wakeUp() does not abort", async ({
      expect,
    }) => {
      let signal: AbortSignal | undefined;
      let release!: () => void;
      const released = new Promise<void>((r) => {
        release = r;
      });
      const { alepha, send, worker } = queueApp(async (app) => {
        signal = app.context.signal;
        await released;
      });
      await alepha.start();

      await send();
      await waitFor(() => signal !== undefined);

      // A second message arrives: the poll wait is cut short again.
      worker.wakeUp();
      expect(signal).not.toBe(alepha.context.appSignal);
      expect(signal?.aborted).toBe(false);
      release();
    });

    it("aborts an in-flight message's signal once stop gives up waiting", async ({
      expect,
    }) => {
      let signal: AbortSignal | undefined;
      const { alepha, send } = queueApp(async (app) => {
        signal = app.context.signal;
        await new Promise((resolve) => {
          app.context.signal.addEventListener("abort", resolve, {
            once: true,
          });
        });
      });
      await alepha.start();
      await send();
      await waitFor(() => signal !== undefined);

      await alepha.stop();

      expect(signal?.aborted).toBe(true);
      expect(alepha.context.isAbortError(signal?.reason)).toBe(true);
    });
  });

  describe("cron ticks", () => {
    it("runs a tick under a signal aborted when the task stops", async ({
      expect,
    }) => {
      const alepha = Alepha.create();
      let signal: AbortSignal | undefined;
      let ticked!: () => void;
      const ticking = new Promise<void>((r) => {
        ticked = r;
      });

      class App {
        cron = $inject(CronProvider);
        alepha = $inject(Alepha);
        register = $hook({
          on: "configure",
          handler: () => {
            this.cron.createCronJob("ambient.tick", "* * * * * *", async () => {
              signal = this.alepha.context.signal;
              ticked();
              await new Promise((resolve) => {
                this.alepha.context.signal.addEventListener("abort", resolve, {
                  once: true,
                });
              });
            });
          },
        });
      }
      alepha.with(App);
      await alepha.start();
      await ticking;

      expect(signal).not.toBe(alepha.context.appSignal);
      expect(signal?.aborted).toBe(false);
      await alepha.stop();
      expect(signal?.aborted).toBe(true);
    }, 5000);
  });

  describe("MCP tool calls", () => {
    it("run under the protocol's cancellation, which is McpContext.signal", async ({
      expect,
    }) => {
      const observed: { same?: boolean; aborted?: boolean } = {};
      let entered!: () => void;
      const entering = new Promise<void>((r) => {
        entered = r;
      });

      class Tools {
        alepha = $inject(Alepha);
        slow = $tool({
          description: "Waits for its cancellation",
          schema: { result: z.text() },
          handler: async ({ context }) => {
            observed.same = context?.signal === this.alepha.context.signal;
            entered();
            await new Promise((resolve) => {
              this.alepha.context.signal.addEventListener("abort", resolve, {
                once: true,
              });
            });
            observed.aborted = this.alepha.context.signal.aborted;
            return "done";
          },
        });
      }

      const alepha = Alepha.create().with(AlephaMcp).with(Tools);
      await alepha.start();
      const provider = alepha.inject(McpServerProvider);

      const call = alepha.context.run(
        () =>
          provider.handleMessage(
            {
              jsonrpc: "2.0",
              id: 7,
              method: "tools/call",
              params: { name: "slow", arguments: {} },
            },
            { clientKey: "alice" },
          ),
        { signal: new AbortController().signal },
      );
      await entering;
      expect(provider.cancelRequest(7, "alice")).toBe(true);

      expect(await call).toBeNull();
      expect(observed).toEqual({ same: true, aborted: true });
    });

    it("composes with the HTTP request's signal it runs inside", async ({
      expect,
    }) => {
      let entered!: () => void;
      const entering = new Promise<void>((r) => {
        entered = r;
      });
      let aborted = false;

      class Tools {
        alepha = $inject(Alepha);
        slow = $tool({
          description: "Waits for its cancellation",
          schema: { result: z.text() },
          handler: async () => {
            entered();
            await new Promise((resolve) => {
              this.alepha.context.signal.addEventListener("abort", resolve, {
                once: true,
              });
            });
            aborted = true;
            return "done";
          },
        });
      }

      const alepha = Alepha.create().with(AlephaMcp).with(Tools);
      await alepha.start();
      const provider = alepha.inject(McpServerProvider);
      const request = new AbortController();

      const call = alepha.context.run(
        () =>
          provider.handleMessage(
            {
              jsonrpc: "2.0",
              id: 8,
              method: "tools/call",
              params: { name: "slow", arguments: {} },
            },
            { clientKey: "bob" },
          ),
        { signal: request.signal },
      );
      await entering;
      request.abort();

      expect(await call).toBeNull();
      expect(aborted).toBe(true);
    });
  });
});
