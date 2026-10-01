import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { AlephaQueue, QueueProvider } from "alepha/queue";
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
   * The delay tier: not deliverable before its time, and never delivered
   * early instead.
   *
   * Delivering early is the failure most likely to ship here, because it
   * looks like graceful degradation and is not: for a push transport,
   * ignoring a delay means delivering NOW, which for a retry is zero backoff
   * against a downstream that has just failed.
   */
  const makeRedisQueue = async () => {
    const alepha = Alepha.create()
      .with({ provide: QueueProvider, use: RedisQueueProvider })
      .with(AlephaRedis)
      .with(AlephaQueue);
    await alepha.start();
    return { alepha, provider: alepha.inject(QueueProvider) };
  };

  test("holds a delayed message until it is due", async () => {
    const { provider } = await makeRedisQueue();
    const queue = `delay-hold-${randomUUID()}`;

    await provider.push(queue, "later", { delaySeconds: 60 });
    // Not on the list, and not returned early.
    expect(await provider.pop(queue)).toBeUndefined();
    expect(await provider.pop(queue)).toBeUndefined();

    // A send with no delay is unaffected and jumps straight to the list.
    await provider.push(queue, "now", { delaySeconds: 0 });
    expect(await provider.pop(queue)).toBe("now");
  });

  test("delivers it once it comes due", async () => {
    const { provider } = await makeRedisQueue();
    const queue = `delay-due-${randomUUID()}`;

    // A real envelope, because the member is stored with a uniqueness prefix
    // and the separator has to survive a payload full of colons - which
    // every `$job` dispatch is, since its queue is `api:jobs:dispatch`.
    const envelope = '{"queue":"api:jobs:dispatch","message":"a:b:c"}';

    // 30 ms rather than a travel(): the due-time lives in Redis, scored in
    // real epoch milliseconds, so a frozen client clock proves nothing.
    await provider.push(queue, envelope, { delaySeconds: 0.03 });
    expect(await provider.pop(queue)).toBeUndefined();

    await new Promise((r) => setTimeout(r, 60));
    expect(await provider.pop(queue)).toBe(envelope);
    // Promoted, not copied.
    expect(await provider.pop(queue)).toBeUndefined();
  });

  test("keeps two identical delayed messages apart", async () => {
    const { provider } = await makeRedisQueue();
    const queue = `delay-dup-${randomUUID()}`;

    // A sorted set stores a member once, so without a unique prefix the
    // second of these would silently overwrite the first and one message
    // would vanish. A LIST has no equivalent failure.
    await provider.push(queue, "same", { delaySeconds: 0.03 });
    await provider.push(queue, "same", { delaySeconds: 0.03 });
    await new Promise((r) => setTimeout(r, 60));

    expect(await provider.pop(queue)).toBe("same");
    expect(await provider.pop(queue)).toBe("same");
    expect(await provider.pop(queue)).toBeUndefined();
  });

  test("a delayed message survives the provider that pushed it", async () => {
    const queue = `delay-restart-${randomUUID()}`;

    const first = await makeRedisQueue();
    await first.provider.push(queue, "durable", { delaySeconds: 0.03 });
    await first.alepha.stop();

    // The due-time is server-side state, so a fresh container picks it up.
    // This is the property a local timer cannot offer: a deploy inside the
    // delay window drops every armed timer it was holding.
    const second = await makeRedisQueue();
    await new Promise((r) => setTimeout(r, 60));
    expect(await second.provider.pop(queue)).toBe("durable");
  });

  test("two pollers racing one due message promote it exactly once", async () => {
    const queue = `delay-race-${randomUUID()}`;

    const a = await makeRedisQueue();
    const b = await makeRedisQueue();

    await a.provider.push(queue, "contested", { delaySeconds: 0.03 });
    await new Promise((r) => setTimeout(r, 60));

    // ZREM is the claim: whichever poller removes the member owns it, so
    // the loser pushes nothing rather than producing a second delivery.
    const [first, second] = await Promise.all([
      a.provider.pop(queue),
      b.provider.pop(queue),
    ]);
    const delivered = [first, second].filter((v) => v !== undefined);
    expect(delivered).toEqual(["contested"]);

    // And nothing is left behind on either side.
    expect(await a.provider.pop(queue)).toBeUndefined();
    expect(await b.provider.pop(queue)).toBeUndefined();
  });
});
