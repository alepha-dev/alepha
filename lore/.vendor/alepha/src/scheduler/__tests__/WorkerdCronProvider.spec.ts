import { Alepha, AlephaError } from "alepha";
import { describe, it } from "vitest";

import { WorkerdCronProvider } from "../providers/WorkerdCronProvider.ts";

describe("WorkerdCronProvider", () => {
  // 2026-01-01T10:37:00.000Z — a fixed instant on an exact minute boundary
  // (cron-schedule's matchDate requires seconds === 0 for 5-field
  // expressions) whose minute-of-hour is non-zero in every whole-minute
  // timezone, keeping the no-match case deterministic.
  const scheduledTime = Date.UTC(2026, 0, 1, 10, 37);

  const create = () => {
    const alepha = Alepha.create({ env: { ALEPHA_SERVERLESS: "1" } });
    return { alepha, cron: alepha.inject(WorkerdCronProvider) };
  };

  it("should run only the jobs whose expression matches the event", async ({
    expect,
  }) => {
    const { alepha, cron } = create();

    const ran: string[] = [];
    const seen: number[] = [];
    cron.createCronJob("hourly", "0 * * * *", async ({ now }) => {
      ran.push("hourly");
      seen.push(now.valueOf());
    });
    cron.createCronJob("five", "*/5 * * * *", async () => {
      ran.push("five");
    });

    await alepha.start();
    await alepha.events.emit("cloudflare:scheduled", {
      cron: "0 * * * *",
      scheduledTime,
    });

    expect(ran).toEqual(["hourly"]);
    expect(seen).toEqual([scheduledTime]);

    await alepha.stop();
  });

  it("should fall back to matching jobs by fire time", async ({ expect }) => {
    const { alepha, cron } = create();

    let calls = 0;
    cron.createCronJob("every-minute", "* * * * *", async () => {
      calls++;
    });

    await alepha.start();
    // No job carries the literal expression, but `* * * * *` fires at the
    // scheduled instant, so the time-based fallback must pick it up.
    await alepha.events.emit("cloudflare:scheduled", {
      cron: "*/3 * * * *",
      scheduledTime,
    });

    expect(calls).toBe(1);

    await alepha.stop();
  });

  it("should do nothing when no job matches the event", async ({ expect }) => {
    const { alepha, cron } = create();

    let calls = 0;
    cron.createCronJob("hourly", "0 * * * *", async () => {
      calls++;
    });

    await alepha.start();
    // Neither the expression nor the fire time (minute 37) matches "hourly".
    await alepha.events.emit("cloudflare:scheduled", {
      cron: "*/3 * * * *",
      scheduledTime,
    });

    expect(calls).toBe(0);

    await alepha.stop();
  });

  it("should register jobs without an AbortController or timer loop", async ({
    expect,
  }) => {
    // Cloudflare Workers forbids creating an AbortController during global
    // scope initialization — the override exists to avoid it.
    const { cron } = create();

    cron.createCronJob("shape", "0 * * * *", async () => {});

    const job = cron.getCronJobs().find((j) => j.name === "shape");
    expect(job?.abort).toBeUndefined();
    expect(job?.loop).toBe(false);
  });

  it("should enforce name and expression validation like the base provider", async ({
    expect,
  }) => {
    const { cron } = create();

    cron.createCronJob("dup", "0 * * * *", async () => {});

    expect(() =>
      cron.createCronJob("dup", "* * * * *", async () => {}),
    ).toThrow(AlephaError);
    expect(() =>
      cron.createCronJob("bad", "not a cron", async () => {}),
    ).toThrow(/bad/);
  });
});
