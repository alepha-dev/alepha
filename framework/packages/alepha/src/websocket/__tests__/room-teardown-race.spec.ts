import { Alepha, z } from "alepha";
import { NodeHttpServerProvider } from "alepha/server";
import { describe, it } from "vitest";
import WebSocket from "ws";

import { AlephaWebSocket } from "../index.ts";
import { $channel } from "../primitives/$channel.ts";
import { $room } from "../primitives/$room.ts";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A socket that joins a room while the last one's leave is still tearing it
 * down: the leaver's close handler used to see `size === 0` and delete the
 * room's engine by key before the join landed. The joiner then sat in an
 * orphaned engine no broadcast reached, and the next socket got a second
 * engine for the same room.
 */
describe("$room join during teardown (Node)", () => {
  it("keeps one engine per room while a socket is in it", async ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } }).with(
      AlephaWebSocket,
    );

    class Game {
      channel = $channel({
        path: "/ws/race",
        schema: {
          in: z.object({ type: z.text() }),
          out: z.object({ type: z.text() }),
        },
      });

      room = $room<any, any, { n: number }>({
        channel: this.channel,
        state: async () => {
          await delay(30);
          return { n: 0 };
        },
        onEmpty: async () => {
          await delay(60);
        },
      });
    }
    const game = alepha.inject(Game);
    await alepha.start();
    const host = alepha
      .inject(NodeHttpServerProvider)
      .hostname.replace("http://", "ws://");
    const open = async () => {
      const ws = new WebSocket(`${host}/ws/race?roomId=r`);
      const received: string[] = [];
      ws.on("message", (d) => received.push((d as Buffer).toString()));
      await new Promise<void>((r) => ws.on("open", () => r()));
      return { ws, received };
    };

    const a = await open();
    await delay(60); // A joined (async state)
    a.ws.close();
    await delay(20); // A's leave is in onEmpty
    const b = await open(); // B joins during the teardown
    await delay(250); // teardown, then B's async state, then A's close handler
    const c = await open();
    await delay(100);

    await game.room.broadcast("r", { type: "hello" });
    await delay(50);

    expect(b.received.some((m) => m.includes("hello"))).toBe(true);
    expect(c.received.some((m) => m.includes("hello"))).toBe(true);

    b.ws.close();
    c.ws.close();
    await alepha.stop();
  });
});
