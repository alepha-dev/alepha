import { Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, it } from "vitest";

import "../index.ts";
import { CronProvider } from "../providers/CronProvider.ts";

describe("CronProvider", () => {
  it("should skip overlapping invocations when handler is still running", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const cron = alepha.inject(CronProvider);
    const dt = alepha.inject(DateTimeProvider);

    let concurrentCount = 0;
    let maxConcurrent = 0;

    cron.createCronJob("slow-task", "* * * * *", async () => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      // Simulate slow handler
      await new Promise((r) => setTimeout(r, 200));
      concurrentCount--;
    });

    await alepha.start();

    // Travel forward to trigger the cron
    await dt.travel([1, "hour"]);
    await new Promise((r) => setTimeout(r, 50));

    // Travel again while the handler is still running (within the 200ms wait)
    await dt.travel([1, "hour"]);
    await new Promise((r) => setTimeout(r, 50));

    // Wait for all handlers to finish
    await new Promise((r) => setTimeout(r, 300));

    expect(maxConcurrent).toBe(1);

    await alepha.stop();
  });

  it("should not run the same job concurrently via trigger()", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const cron = alepha.inject(CronProvider);

    let concurrent = 0;
    let maxConcurrent = 0;
    let calls = 0;

    cron.createCronJob("slow-trigger", "* * * * *", async () => {
      concurrent++;
      calls++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 100));
      concurrent--;
    });

    await Promise.all([
      cron.trigger("slow-trigger"),
      cron.trigger("slow-trigger"),
    ]);

    expect(maxConcurrent).toBe(1);
    expect(calls).toBe(1);

    // The guard must reset once the run finishes — a later trigger runs again.
    await cron.trigger("slow-trigger");
    expect(calls).toBe(2);
  });

  it("should reject duplicate cron job names", async ({ expect }) => {
    const alepha = Alepha.create();
    const cron = alepha.inject(CronProvider);

    cron.createCronJob("dup", "* * * * *", async () => {});

    expect(() =>
      cron.createCronJob("dup", "*/5 * * * *", async () => {}),
    ).toThrow(AlephaError);
  });

  it("should throw AlephaError naming the job on an invalid cron expression", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const cron = alepha.inject(CronProvider);

    expect(() =>
      cron.createCronJob("bad-cron", "not a cron", async () => {}),
    ).toThrow(AlephaError);
    expect(() =>
      cron.createCronJob("bad-cron", "not a cron", async () => {}),
    ).toThrow(/bad-cron/);
  });

  it("should not start a timer loop from createCronJob(start) in serverless", async ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { ALEPHA_SERVERLESS: "1" } });
    const cron = alepha.inject(CronProvider);
    const dt = alepha.inject(DateTimeProvider);

    await alepha.start();

    let calls = 0;
    cron.createCronJob(
      "late-serverless",
      "* * * * *",
      async () => {
        calls++;
      },
      true,
    );

    const job = cron.getCronJobs().find((j) => j.name === "late-serverless");
    expect(job?.running).toBeFalsy();

    await dt.travel([2, "minute"]);
    expect(calls).toBe(0);

    await alepha.stop();
  });

  it("should stop ticking after abort() and ignore unknown names", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const cron = alepha.inject(CronProvider);
    const dt = alepha.inject(DateTimeProvider);
    await dt.travel([0, "millisecond"]); // pin the clock

    let calls = 0;
    cron.createCronJob("tick", "* * * * *", async () => {
      calls++;
    });

    await alepha.start();

    await dt.travel([90, "second"]);
    const callsBeforeAbort = calls;
    expect(callsBeforeAbort).toBeGreaterThanOrEqual(1);

    cron.abort("tick");
    cron.abort("does-not-exist"); // must be a harmless no-op

    await dt.travel([5, "minute"]);
    expect(calls).toBe(callsBeforeAbort);

    await alepha.stop();
  });

  it("should stop all jobs on alepha.stop() and resume on restart", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const cron = alepha.inject(CronProvider);
    const dt = alepha.inject(DateTimeProvider);
    await dt.travel([0, "millisecond"]);

    let calls = 0;
    cron.createCronJob("lifecycle", "* * * * *", async () => {
      calls++;
    });

    await alepha.start();
    await dt.travel([90, "second"]);
    expect(calls).toBeGreaterThanOrEqual(1);

    await alepha.stop();
    const callsAfterStop = calls;
    expect(
      cron.getCronJobs().find((j) => j.name === "lifecycle")?.running,
    ).toBe(false);

    await dt.travel([5, "minute"]);
    expect(calls).toBe(callsAfterStop);

    await alepha.start();
    await dt.travel([90, "second"]);
    expect(calls).toBeGreaterThan(callsAfterStop);

    await alepha.stop();
  });

  it("should keep the loop alive when the handler rejects", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const cron = alepha.inject(CronProvider);
    const dt = alepha.inject(DateTimeProvider);
    await dt.travel([0, "millisecond"]);

    let calls = 0;
    cron.createCronJob("flaky", "* * * * *", async () => {
      calls++;
      throw new AlephaError("boom");
    });

    await alepha.start();

    await dt.travel([90, "second"]);
    const callsAfterFirstTravel = calls;
    expect(callsAfterFirstTravel).toBeGreaterThanOrEqual(1);

    await dt.travel([90, "second"]);
    expect(calls).toBeGreaterThan(callsAfterFirstTravel);

    await alepha.stop();
  });

  it("should pass the scheduled tick time to the handler", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const cron = alepha.inject(CronProvider);
    const dt = alepha.inject(DateTimeProvider);
    await dt.travel([0, "millisecond"]);

    const seen: number[] = [];
    cron.createCronJob("aligned", "* * * * *", async ({ now }) => {
      seen.push(now.valueOf());
    });

    await alepha.start();
    await dt.travel([2, "minute"]);

    expect(seen.length).toBeGreaterThanOrEqual(1);
    for (const tick of seen) {
      // Ticks carry the scheduled cron instant, not "whenever the timer
      // actually fired" — for `* * * * *` that is an exact minute boundary.
      expect(tick % 60000).toBe(0);
    }

    await alepha.stop();
  });

  it("should boot a job registered with start=true after the app started", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const cron = alepha.inject(CronProvider);
    const dt = alepha.inject(DateTimeProvider);
    await dt.travel([0, "millisecond"]);

    await alepha.start();

    let calls = 0;
    cron.createCronJob(
      "late",
      "* * * * *",
      async () => {
        calls++;
      },
      true,
    );

    await dt.travel([90, "second"]);
    expect(calls).toBeGreaterThanOrEqual(1);

    await alepha.stop();
  });

  it("should resolve trigger() for an unknown job without throwing", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const cron = alepha.inject(CronProvider);

    await expect(cron.trigger("does-not-exist")).resolves.toBeUndefined();
  });

  it("should run remaining jobs when one fails in triggerAll()", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const cron = alepha.inject(CronProvider);

    let okCalls = 0;
    cron.createCronJob("ok", "* * * * *", async () => {
      okCalls++;
    });
    cron.createCronJob("ko", "* * * * *", async () => {
      throw new AlephaError("nope");
    });

    await expect(cron.triggerAll()).resolves.toBeUndefined();
    expect(okCalls).toBe(1);
  });

  it("should run jobs via the serverless:cron hook by name", async ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { ALEPHA_SERVERLESS: "1" } });
    const cron = alepha.inject(CronProvider);

    let calls = 0;
    cron.createCronJob("email-digest", "0 * * * *", async () => {
      calls++;
    });

    await alepha.start();

    // The start hook must not boot timer loops in serverless.
    expect(
      cron.getCronJobs().find((j) => j.name === "email-digest")?.running,
    ).toBeFalsy();

    await alepha.events.emit("serverless:cron", { name: "email-digest" });
    expect(calls).toBe(1);

    // Unknown names only warn.
    await alepha.events.emit("serverless:cron", { name: "does-not-exist" });
    expect(calls).toBe(1);

    await alepha.stop();
  });
});
