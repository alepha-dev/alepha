import { RedisTopicProvider } from "alepha/topic-redis";
import { describe, test } from "vitest";
import { RedisLockProvider } from "../../src/lock-redis";
import {
  testLockBasic,
  testLockGracePeriod,
  testLockWait,
} from "../lock/shared.ts";

describe("RedisLockProvider", () => {
  const Provider = RedisLockProvider;
  const TopicProvider = RedisTopicProvider;

  test("should lock without waiting", async () => {
    await testLockBasic(Provider, TopicProvider);
  });

  test("should lock with waiting", async () => {
    await testLockWait(Provider, TopicProvider);
  });

  test("should lock with grace period", async () => {
    await testLockGracePeriod(Provider, TopicProvider);
  });
});
