import { $hook, $inject, Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import {
  MemoryQueueProvider,
  QueueCodec,
  QueueProvider,
  queueWorkerOptions,
  WorkerProvider,
} from "../index.ts";

/**
 * The poll loop waits on the abort signal of a controller that `stopWorkers`
 * aborted and never replaced. `startWorkers` only creates one when none
 * exists, so after a stop/start cycle every wait returned at once and the
 * worker hammered the queue in a hot loop.
 */
class CountingQueue extends MemoryQueueProvider {
  public pops = 0;

  public override async pop(queue: string): Promise<string | undefined> {
    this.pops++;
    return super.pop(queue);
  }
}

class TestWorker extends WorkerProvider {
  public get controller(): AbortController | undefined {
    return this.abortController;
  }

  public get running(): number {
    return this.workersRunning;
  }
}

class Consumer {
  protected readonly queue = $inject(QueueProvider);
  protected readonly worker = $inject(WorkerProvider);
  protected readonly registration = $hook({
    on: "start",
    handler: () => {
      this.worker.register({
        name: "q",
        schema: z.object({}),
        provider: this.queue,
        handler: async () => {},
      });
    },
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("WorkerProvider restart", () => {
  it("polls at the configured interval after a stop/start cycle", async () => {
    const app = Alepha.create({ env: { LOG_LEVEL: "error" } });
    app.store.mut(queueWorkerOptions, () => ({
      concurrency: 1,
      interval: 1000,
      maxInterval: 32000,
    }));
    app.with({ provide: WorkerProvider, use: TestWorker });
    app.with({ provide: QueueProvider, use: CountingQueue });
    app.with(QueueCodec);
    app.with(Consumer);

    const worker = app.inject(TestWorker);
    const queue = app.inject(CountingQueue);

    await app.start();
    await sleep(150);
    expect(worker.running).toBe(1);
    const popsFirstRun = queue.pops;

    await app.stop();
    expect(worker.running).toBe(0);
    expect(worker.controller).toBeUndefined();

    await app.start();
    await sleep(150);
    const popsSecondRun = queue.pops - popsFirstRun;
    await app.stop();

    // With a one-second interval, 150 ms of wall time is a handful of polls
    // at most; the hot loop reached thousands.
    expect(popsSecondRun).toBeLessThan(10);
  });
});
