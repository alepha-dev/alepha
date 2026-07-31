import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { BayAdminApi } from "../src/api/index.ts";
import {
  type AppUsagePoint,
  AppUsageService,
} from "../src/api/services/AppUsageService.ts";

const setup = () => {
  const alepha = Alepha.create({
    env: {
      APP_SECRET: "test-secret",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
    },
  }).with(BayAdminApi);
  return alepha.inject(AppUsageService);
};

/** Same, but booted — the repository needs a live connection. */
const setupStarted = async () => {
  const alepha = Alepha.create({
    env: {
      APP_SECRET: "test-secret",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
    },
  }).with(BayAdminApi);
  const usage = alepha.inject(AppUsageService);
  await alepha.start();
  return usage;
};

const point = (
  at: string,
  cpuSecondsRaw: number | undefined,
  restarts = 0,
): AppUsagePoint => ({ at, running: true, cpuSecondsRaw, restarts });

describe("AppUsageService — turning the CPU counter into a rate", () => {
  /*
    The supervisor reports CUMULATIVE cpu seconds since the unit started. It is
    stored raw because a rate cannot be recovered from an average, so the
    differencing happens here, on read.
  */

  it("should difference two samples into a share of one core", () => {
    const usage = setup();

    const points = usage.withCpuRate([
      point("2026-08-01T10:00:00Z", 10),
      // 30 CPU-seconds over 60 wall-clock seconds is half a core.
      point("2026-08-01T10:01:00Z", 40),
    ]);

    expect(points[1].cpuPercent).toBeCloseTo(50, 5);
  });

  it("should leave the first sample without a rate", () => {
    // There is nothing to difference against. Reporting 0% would draw an idle
    // minute that never happened.
    const usage = setup();

    const points = usage.withCpuRate([
      point("2026-08-01T10:00:00Z", 10),
      point("2026-08-01T10:01:00Z", 40),
    ]);

    expect(points[0].cpuPercent).toBeUndefined();
  });

  it("should skip the interval where the counter went backwards", () => {
    /*
      The counter resets to zero when the unit restarts. Differencing across
      that gives a large negative number, and clamping it to zero would draw a
      quiet minute exactly where the process died — which is the one minute
      somebody reading this chart is looking for.
    */
    const usage = setup();

    const points = usage.withCpuRate([
      point("2026-08-01T10:00:00Z", 120),
      point("2026-08-01T10:01:00Z", 2, 1),
      point("2026-08-01T10:02:00Z", 32, 1),
    ]);

    expect(points[1].cpuPercent).toBeUndefined();
    // And the interval AFTER the restart is fine again: both ends are from the
    // same run.
    expect(points[2].cpuPercent).toBeCloseTo(50, 5);
  });

  it("should not invent a rate when a sample has no counter", () => {
    // An app the supervisor knew nothing about — stopped, or a Bay that was
    // restarting. The gap is the honest answer.
    const usage = setup();

    const points = usage.withCpuRate([
      point("2026-08-01T10:00:00Z", 10),
      point("2026-08-01T10:01:00Z", undefined),
      point("2026-08-01T10:02:00Z", 70),
    ]);

    expect(points[1].cpuPercent).toBeUndefined();
    expect(points[2].cpuPercent).toBeUndefined();
  });

  it("should not divide by zero when two samples share a timestamp", () => {
    // Two samples in the same second should not produce Infinity on a chart.
    const usage = setup();

    const points = usage.withCpuRate([
      point("2026-08-01T10:00:00Z", 10),
      point("2026-08-01T10:00:00Z", 40),
    ]);

    expect(points[1].cpuPercent).toBeUndefined();
  });
});

describe("AppUsageService — the series", () => {
  it("should record a sample per app and read it back in order", async () => {
    const usage = await setupStarted();

    // Written directly rather than through `sample()`, which would need a Bay
    // to talk to — what is under test here is the storage and the ordering.
    const repo = (usage as unknown as { usage: any }).usage;
    await repo.createMany([
      {
        appKey: "demo/production",
        at: "2026-08-01T10:01:00Z",
        running: true,
        memoryBytes: 200,
      },
      {
        appKey: "demo/production",
        at: "2026-08-01T10:00:00Z",
        running: true,
        memoryBytes: 100,
      },
      { appKey: "other/production", at: "2026-08-01T10:00:00Z", running: true },
    ]);

    const points = await usage.series("demo/production", 24 * 365 * 100);

    expect(points.map((p) => p.memoryBytes)).toEqual([100, 200]);
  });

  it("should keep a stopped sample rather than dropping the row", async () => {
    /*
      "The app was stopped" and "bay-admin could not reach Bay" both produce an
      absent measurement, and only one of them is the app's fault. Recording
      `running: false` is what tells them apart later.
    */
    const usage = await setupStarted();

    const repo = (usage as unknown as { usage: any }).usage;
    await repo.createMany([
      { appKey: "down/production", at: "2026-08-01T10:00:00Z", running: false },
    ]);

    const points = await usage.series("down/production", 24 * 365 * 100);

    expect(points).toHaveLength(1);
    expect(points[0].running).toBe(false);
    expect(points[0].memoryBytes).toBeUndefined();
  });
});
