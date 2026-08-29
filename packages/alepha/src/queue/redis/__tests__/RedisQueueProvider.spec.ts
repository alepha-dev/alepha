import { Alepha } from "alepha";
import {
  AlephaQueue,
  QueueDelayNotSupportedError,
  QueueProvider,
} from "alepha/queue";
import { AlephaRedis } from "alepha/redis";
import { describe, expect, test } from "vitest";

import {
  testQueueBasic,
  testQueueHasConsumer,
  testQueueKillWorkerSleep,
} from "../../core/__tests__/shared.ts";
import { RedisQueueProvider } from "../index.ts";

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

  /**
   * The rule that lets three backends share one interface: a backend which
   * cannot honour a delay DECLINES rather than enqueueing immediately.
   *
   * Getting this wrong is the failure most likely to ship, because it looks
   * like graceful degradation and is not: for a push transport, ignoring a
   * delay means delivering NOW, which for a retry is zero backoff against a
   * downstream that has just failed.
   */
  test("declines a delayed send rather than delivering it now", async () => {
    const alepha = Alepha.create()
      .with({ provide: QueueProvider, use: RedisQueueProvider })
      .with(AlephaRedis)
      .with(AlephaQueue);
    await alepha.start();

    const provider = alepha.inject(QueueProvider);
    await expect(
      provider.push("delay-decline", "hello", { delaySeconds: 30 }),
    ).rejects.toBeInstanceOf(QueueDelayNotSupportedError);

    // Nothing was written: a declined send must leave the queue untouched.
    expect(await provider.pop("delay-decline")).toBeUndefined();

    // A send with no delay still works, and one with `delaySeconds: 0` is
    // not a delay at all.
    await provider.push("delay-decline", "now", { delaySeconds: 0 });
    expect(await provider.pop("delay-decline")).toBe("now");
  });
});
