import { Alepha } from "alepha";
import { describe, it } from "vitest";

import {
  CloudflareDurableObjectWebSocketServerProvider,
  WEBSOCKET_DEFAULT_BINDING,
} from "../providers/CloudflareDurableObjectWebSocketServerProvider.ts";

/**
 * Fake DurableObjectNamespace capturing broadcast RPCs.
 */
function fakeNamespace() {
  const calls: Array<{ name: string; message: any; criteria: any }> = [];
  return {
    calls,
    idFromName: (name: string) => ({ name }),
    get: (id: { name: string }) => ({
      broadcast: async (message: any, criteria: any) => {
        calls.push({ name: id.name, message, criteria });
      },
    }),
  };
}

describe("CloudflareDurableObjectWebSocketServerProvider.emit", () => {
  const setup = () => {
    const alepha = Alepha.create();
    const provider = alepha.inject(
      CloudflareDurableObjectWebSocketServerProvider,
    );
    const ns = fakeNamespace();
    alepha.store.set("cloudflare.env", {
      [WEBSOCKET_DEFAULT_BINDING]: ns,
    } as any);
    return { provider, ns };
  };

  it("routes a roomId emit to the channel:room DO", async ({ expect }) => {
    const { provider, ns } = setup();
    await provider.emit("/ws/chat", {
      message: { t: 1 },
      roomId: "lobby",
      exceptConnectionIds: ["x"],
    });
    expect(ns.calls).toEqual([
      {
        name: "/ws/chat:lobby",
        message: { t: 1 },
        criteria: { exceptConnectionIds: ["x"] },
      },
    ]);
  });

  it("fans a roomIds emit to each room DO", async ({ expect }) => {
    const { provider, ns } = setup();
    await provider.emit("/ws/chat", {
      message: { t: 2 },
      roomIds: ["a", "b"],
    });
    expect(ns.calls.map((c) => c.name)).toEqual(["/ws/chat:a", "/ws/chat:b"]);
  });

  it("throws when targeting is not room-scoped", async ({ expect }) => {
    const { provider } = setup();
    await expect(
      provider.emit("/ws/chat", { message: {}, userId: "u1" }),
    ).rejects.toThrow(/roomId/);
    await expect(provider.emit("/ws/chat", { message: {} })).rejects.toThrow(
      /roomId/,
    );
  });
});
