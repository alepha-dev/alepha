import { describe, it, test } from "vitest";

import {
  SharedTopicProvider,
  testTopicAsSub,
  testTopicBasic,
  testTopicLateSubscribe,
  testTopicParams,
  testTopicRetain,
} from "../__tests__/shared.ts";

describe("$topic - memory", () => {
  const provider = SharedTopicProvider;

  test("should subscribe and publish", async () => {
    await testTopicBasic(provider);
  });

  test("should subscribe with handler", async () => {
    await testTopicAsSub(provider);
  });

  test("should subscribe after start with provider", async () => {
    await testTopicLateSubscribe(provider);
  });

  it("should deliver retained message to new subscriber", async () => {
    await testTopicRetain(SharedTopicProvider);
  });

  it("should support parameterized topic names", async () => {
    await testTopicParams(SharedTopicProvider);
  });
});
