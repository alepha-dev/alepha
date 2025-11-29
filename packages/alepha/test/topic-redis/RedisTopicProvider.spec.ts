import { RedisTopicProvider } from "alepha/topic/redis";
import { describe, test } from "vitest";
import {
  testTopicAsSub,
  testTopicBasic,
  testTopicLateSubscribe,
} from "../topic/shared.ts";

describe("$topic - redis", () => {
  const provider = RedisTopicProvider;

  test("should subscribe and publish", async () => {
    await testTopicBasic(provider);
  });

  test("should subscribe with handler", async () => {
    await testTopicAsSub(provider);
  });

  test("should subscribe after start with provider", async () => {
    await testTopicLateSubscribe(provider);
  });
});
