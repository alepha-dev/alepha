import { RedisLockProvider } from "alepha/lock-redis";
import { describe, test } from "vitest";
import { SharedLockProvider, testSchedulerBasic } from "./shared.ts";

describe("$scheduler - interval", () => {
  const scheduler = { interval: [1, "minute"] } as any;

  test("should trigger all apps", async () => {
    await testSchedulerBasic({
      scheduler,
    });
  });
  test("should trigger one app (memory)", async () => {
    await testSchedulerBasic({
      lock: SharedLockProvider,
      scheduler,
    });
  });
  test("should trigger one app (redis)", { retry: 3 }, async () => {
    await testSchedulerBasic({
      lock: RedisLockProvider,
      scheduler,
    });
  });
});
