import {
  testQueueBasic,
  testQueueHasConsumer,
  testQueueKillWorkerSleep,
} from "@alepha/queue/test/shared.ts";
import { describe, test } from "vitest";
import { RedisQueueProvider } from "../src";

describe("RedisQueueProvider", () => {
  const Provider = RedisQueueProvider;

  test("should push and pop with consumer", async () => {
    await testQueueBasic(Provider);
  });

  test("should push and pop with handler", async () => {
    await testQueueHasConsumer(Provider);
  });

  test("should wake up workers on push", async () => {
    await testQueueKillWorkerSleep(Provider);
  });
});
