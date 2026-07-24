import { describe, test } from "vitest";
import {
  SharedLockProvider,
  SharedTopicProvider,
  testDelIfOwner,
  testLockBasic,
  testLockGracePeriod,
  testLockWait,
} from "../__tests__/shared.ts";

describe("MemoryLockProvider", () => {
  const Provider = SharedLockProvider;
  const TopicProvider = SharedTopicProvider;

  test("should lock without waiting", async () => {
    await testLockBasic(Provider, TopicProvider);
  });

  test("should lock and wait", async () => {
    await testLockWait(Provider, TopicProvider);
  });

  test("should lock with grace period", async () => {
    await testLockGracePeriod(Provider, TopicProvider);
  });

  test("delIfOwner only deletes the caller's own lock", async () => {
    await testDelIfOwner(Provider);
  });
});
