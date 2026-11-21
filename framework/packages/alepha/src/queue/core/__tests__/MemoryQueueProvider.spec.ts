import { describe, test } from "vitest";

import {
  SharedQueueProvider,
  testQueueBasic,
  testQueueHasConsumer,
  testQueueWakeUpOnPush,
} from "../__tests__/shared.ts";

describe("MemoryQueueProvider", () => {
  const Provider = SharedQueueProvider;

  test("should push and pop with consumer", async () => {
    await testQueueBasic(Provider);
  });

  test("should push and pop with handler", async () => {
    await testQueueHasConsumer(Provider);
  });

  test("should wake up workers on push", async () => {
    await testQueueWakeUpOnPush(Provider);
  });
});
