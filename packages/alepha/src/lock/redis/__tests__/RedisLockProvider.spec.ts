import { RedisTopicProvider } from "alepha/topic/redis";
import { describe, test } from "vitest";

import {
  testDelIfOwner,
  testLockBasic,
  testLockGracePeriod,
  testLockWait,
} from "../../core/__tests__/shared.ts";
import { RedisLockProvider } from "../index.ts";

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

  test("delIfOwner only deletes the caller's own lock", async () => {
    await testDelIfOwner(Provider);
  });
});
