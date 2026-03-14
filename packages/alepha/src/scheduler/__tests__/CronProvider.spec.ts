import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, it } from "vitest";
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
    let totalCalls = 0;

    cron.createCronJob("slow-task", "* * * * *", async () => {
      concurrentCount++;
      totalCalls++;
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
});
