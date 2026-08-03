import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { DirectJobDispatcher } from "../providers/DirectJobDispatcher.ts";
import { JobProvider } from "../providers/JobProvider.ts";
import { jobConfig } from "../schemas/jobConfigAtom.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Counts how many executions are in flight at once, which is the only thing
 * this dispatcher's bound is about.
 */
class ConcurrencyProbe {
  public inFlight = 0;
  public peak = 0;
  public completed: string[] = [];

  async run(executionId: string): Promise<void> {
    this.inFlight++;
    this.peak = Math.max(this.peak, this.inFlight);
    await sleep(5);
    this.inFlight--;
    this.completed.push(executionId);
  }
}

/**
 * Substituting the whole `JobProvider` keeps this a unit test of the
 * dispatcher: no database, no outbox, no sweep — just "how many handlers did
 * it start at once".
 */
const dispatcherWith = (probe: ConcurrencyProbe, maxConcurrency: number) => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "silent", DATABASE_URL: "sqlite://:memory:" },
  });
  alepha.with({
    provide: JobProvider,
    use: class extends JobProvider {
      processExecution = async (_jobName: string, executionId: string) => {
        await probe.run(executionId);
      };
    },
  });
  alepha.store.set(jobConfig, {
    ...alepha.store.get(jobConfig),
    directMaxConcurrency: maxConcurrency,
  });
  return { alepha, dispatcher: alepha.inject(DirectJobDispatcher) };
};

/** Wait for every dispatched execution to have run. */
const drained = async (probe: ConcurrencyProbe, expected: number) => {
  for (let i = 0; i < 200 && probe.completed.length < expected; i++) {
    await sleep(10);
  }
};

describe("DirectJobDispatcher", () => {
  it("never runs more executions at once than the configured cap", async () => {
    const probe = new ConcurrencyProbe();
    const { alepha, dispatcher } = dispatcherWith(probe, 3);
    await alepha.start();

    // The shape that used to take the database pool down: one pushMany of
    // many rows, dispatched back to back with nothing in between.
    for (let i = 0; i < 25; i++) {
      await dispatcher.dispatch("notify", `exec-${i}`);
    }

    await drained(probe, 25);

    expect(probe.completed).toHaveLength(25);
    expect(probe.peak).toBeLessThanOrEqual(3);
    // Guards the opposite failure: a cap of 1 would also satisfy the bound
    // while serialising everything and making a blast take 25x longer.
    expect(probe.peak).toBeGreaterThan(1);
  });

  it("picks up a dispatch that arrives while the queue is draining", async () => {
    const probe = new ConcurrencyProbe();
    const { alepha, dispatcher } = dispatcherWith(probe, 2);
    await alepha.start();

    await dispatcher.dispatch("notify", "first");
    // Lands mid-drain — the window where a naive `draining` flag drops the
    // work until something else happens to arrive.
    await sleep(2);
    await dispatcher.dispatch("notify", "second");

    await drained(probe, 2);

    expect(probe.completed.sort()).toEqual(["first", "second"]);
  });

  it("keeps draining after a handler throws", async () => {
    const probe = new ConcurrencyProbe();
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "silent", DATABASE_URL: "sqlite://:memory:" },
    });
    alepha.with({
      provide: JobProvider,
      use: class extends JobProvider {
        processExecution = async (_jobName: string, executionId: string) => {
          if (executionId === "exec-0") {
            throw new Error("handler blew up");
          }
          await probe.run(executionId);
        };
      },
    });
    const dispatcher = alepha.inject(DirectJobDispatcher);
    await alepha.start();

    for (let i = 0; i < 5; i++) {
      await dispatcher.dispatch("notify", `exec-${i}`);
    }

    await drained(probe, 4);

    // The failed one is left to the sweep; the other four still ran.
    expect(probe.completed.sort()).toEqual([
      "exec-1",
      "exec-2",
      "exec-3",
      "exec-4",
    ]);
  });
});
