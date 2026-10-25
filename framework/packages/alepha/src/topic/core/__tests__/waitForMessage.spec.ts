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

  it("should wait on a templated name and hand the params to filter and result", async () => {
    // It subscribed to the literal `devices/{id}/status` string, so a
    // message on `devices/d1/status` never reached it, on any provider.
    const alepha = Alepha.create();
    const topics = alepha.inject(MemoryTopicProvider);
    await alepha.start();

    const seen: string[] = [];
    const params = z.object({ id: z.text() });
    const waiting = topics.waitForMessage<{
      payload: typeof payload;
      params: typeof params;
    }>("devices/{id}/status", payload, {
      timeout: [2, "seconds"],
      filter: (message) => {
        seen.push(message.params.id);
        return message.params.id === "d2";
      },
    });

    await new Promise((r) => setTimeout(r, 0));
    await topics.publishMessage(
      "devices/{id}/status",
      payload,
      { value: "a" },
      {
        params: { id: "d1" },
      },
    );
    await topics.publishMessage(
      "devices/{id}/status",
      payload,
      { value: "b" },
      {
        params: { id: "d2" },
      },
    );

    const message = await waiting;
    expect(seen).toEqual(["d1", "d2"]);
    expect(message.params).toEqual({ id: "d2" });
    expect(message.payload).toEqual({ value: "b" });
  });
});
