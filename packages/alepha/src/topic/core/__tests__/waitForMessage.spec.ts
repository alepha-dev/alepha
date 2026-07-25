import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";
import { MemoryTopicProvider } from "../providers/MemoryTopicProvider.ts";
import { TopicProvider } from "../providers/TopicProvider.ts";

const payload = z.object({ value: z.text() });

describe("TopicProvider.waitForMessage", () => {
  it("should reject when subscribing fails", async () => {
    // The subscribe call sat in an un-awaited async IIFE with no catch, so a
    // rejection was swallowed: neither resolve nor reject ever ran and the
    // caller awaited forever, with no timeout armed to rescue it.
    class BrokenTopicProvider extends MemoryTopicProvider {
      public override async subscribe(): Promise<() => Promise<void>> {
        throw new Error("broker unreachable");
      }
    }

    const alepha = Alepha.create().with({
      provide: TopicProvider,
      use: BrokenTopicProvider,
    });
    const topics = alepha.inject(BrokenTopicProvider);
    await alepha.start();

    await expect(
      topics.waitForMessage("some-topic", payload, { timeout: [5, "seconds"] }),
    ).rejects.toThrow(/broker unreachable/);
  });

  it("should still time out when no message arrives", async () => {
    const alepha = Alepha.create();
    const topics = alepha.inject(MemoryTopicProvider);
    await alepha.start();

    await expect(
      topics.waitForMessage("quiet-topic", payload, {
        timeout: [50, "milliseconds"],
      }),
    ).rejects.toThrow();
  });

  it("should resolve with a matching message", async () => {
    const alepha = Alepha.create();
    const topics = alepha.inject(MemoryTopicProvider);
    await alepha.start();

    const waiting = topics.waitForMessage("live-topic", payload, {
      timeout: [2, "seconds"],
    });

    await new Promise((r) => setTimeout(r, 20));
    await topics.publishMessage("live-topic", payload, { value: "hello" });

    const message = await waiting;
    expect(message.payload).toEqual({ value: "hello" });
  });
});
