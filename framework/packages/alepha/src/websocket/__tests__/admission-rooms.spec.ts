import { Alepha, z } from "alepha";
import { describe, it } from "vitest";

import { AlephaWebSocket } from "../index.ts";
import { $channel } from "../primitives/$channel.ts";
import { $websocket } from "../primitives/$websocket.ts";
import { WebSocketServerProvider } from "../providers/WebSocketServerProvider.ts";

/**
 * The room a socket lands in is a room `canJoin` approved, by one rule on
 * both engines. The generated Cloudflare entry used to pick its room with a
 * parsing of its own: `?roomIds=,b` asked `canJoin` about `b` only and routed
 * the socket to `default`; `?roomId=` asked about `""`.
 */
describe("WebSocket admission rooms", () => {
  const boot = async () => {
    const asked: string[] = [];
    class App {
      channel = $channel({
        path: "/ws/rooms",
        schema: {
          in: z.object({ t: z.text() }),
          out: z.object({ t: z.text() }),
        },
      });
      socket = $websocket({
        channel: this.channel,
        canJoin: ({ roomId }) => {
          asked.push(roomId);
          return true;
        },
        handler: async () => {},
      });
    }
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with(AlephaWebSocket)
      .with(App);
    await alepha.start();
    const provider = alepha.inject(WebSocketServerProvider);
    const endpoint = provider.getEndpoint("/ws/rooms") as never;
    return { provider, endpoint, asked };
  };

  for (const query of [
    "?roomIds=,b",
    "?roomIds=%20,b",
    "?roomId=",
    "?roomId=&roomIds=,b",
    "?roomId=%20",
    "",
  ]) {
    it(`lands in a room canJoin was asked about (${query || "no query"})`, async ({
      expect,
    }) => {
      const { provider, endpoint, asked } = await boot();
      const url = `/ws/rooms${query}`;

      const admission = await provider.admit(endpoint, { url, headers: {} });

      expect(admission.accepted).toBe(true);
      expect(asked.every((room) => room.trim() !== "")).toBe(true);
      const room = provider.roomIdFor(url);
      expect(asked).toContain(room);
    });
  }
});
