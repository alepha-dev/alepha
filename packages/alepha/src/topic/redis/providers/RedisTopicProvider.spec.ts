import { describe, test } from "vitest";
import {
  testTopicAsSub,
  testTopicBasic,
  testTopicLateSubscribe,
} from "../../core/__tests__/shared.ts";
import { RedisTopicProvider } from "../index.ts";

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
