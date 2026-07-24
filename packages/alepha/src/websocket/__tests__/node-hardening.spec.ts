import { Alepha, z } from "alepha";
import { NodeHttpServerProvider } from "alepha/server";
import { describe, test } from "vitest";
import WebSocket from "ws";
import { AlephaWebSocket } from "../index.ts";
import { $channel } from "../primitives/$channel.ts";
import { $room } from "../primitives/$room.ts";
import { $websocket } from "../primitives/$websocket.ts";

const waitForOpen = (ws: WebSocket) =>
  new Promise<void>((resolve) => ws.on("open", resolve));

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const messageSchema = z.object({ content: z.text() });

const hostnameOf = (alepha: Alepha) =>
  alepha.inject(NodeHttpServerProvider).hostname.replace("http://", "ws://");

describe("NodeWebSocketServerProvider — hardening", () => {
  test("connection ids are globally unique, not per-process counters", async ({
    expect,
  }) => {
    const ids: string[] = [];
    const alepha = Alepha.create().with(AlephaWebSocket);

    class Controller {
      ch = $channel({
        path: "/ws/ids",
        schema: { in: messageSchema, out: messageSchema },
      });

      ws = $websocket({
        channel: this.ch,
        handler: async () => {},
        onConnect: ({ connectionId }) => {
          ids.push(connectionId);
        },
      });
    }

    alepha.inject(Controller);
    await alepha.start();

    const ws = new WebSocket(`${hostnameOf(alepha)}/ws/ids`);
    await waitForOpen(ws);
    await delay(100);

    // Sequential `ws-1`, `ws-2` ids collide across instances: with two
    // servers behind the topic bus, instance B's `ws-1` receives messages
    // addressed to instance A's `ws-1`.
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toMatch(/^ws-\d+$/);
    expect(ids[0]).toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    );

    ws.close();
    await alepha.stop();
  });

  test("a frame cannot address a room the client never joined", async ({
    expect,
  }) => {
    const targets: string[] = [];
    const alepha = Alepha.create().with(AlephaWebSocket);

    class Controller {
      ch = $channel({
        path: "/ws/spoof",
        schema: { in: messageSchema, out: messageSchema },
      });

      ws = $websocket({
        channel: this.ch,
        handler: async ({ roomId, reply }) => {
          targets.push(roomId);
          await reply({ message: { content: "ack" } });
        },
      });
    }

    alepha.inject(Controller);
    await alepha.start();

    const ws = new WebSocket(`${hostnameOf(alepha)}/ws/spoof?roomId=lobby`);
    await waitForOpen(ws);

    // The client claims a room it never joined. Cloudflare refuses this
    // (assertReplyRoom); Node must not let a client broadcast into it.
    ws.send(
      JSON.stringify({ roomId: "private-room", message: { content: "hi" } }),
    );
    await delay(150);

    expect(targets).not.toContain("private-room");

    ws.close();
    await alepha.stop();
  });

  test("a disconnect during an async room join leaves no ghost socket", async ({
    expect,
  }) => {
    let emptied = 0;
    const alepha = Alepha.create().with(AlephaWebSocket);

    class Controller {
      ch = $channel({
        path: "/ws/ghost",
        schema: { in: messageSchema, out: messageSchema },
      });

      room = $room({
        channel: this.ch,
        // Slow factory: the client disconnects while the room is still
        // coming to life.
        state: async () => {
          await delay(120);
          return { n: 0 };
        },
        tickHz: 20,
        onEmpty: () => {
          emptied++;
        },
      });
    }

    alepha.inject(Controller);
    await alepha.start();

    const ws = new WebSocket(`${hostnameOf(alepha)}/ws/ghost?roomId=r1`);
    await waitForOpen(ws);
    // Close while the state factory is still pending.
    ws.close();

    await delay(400);

    // The socket must not be admitted after its close: a ghost keeps the
    // room non-empty forever (tick loop spinning, onEmpty never persisting).
    expect(emptied).toBe(1);

    await alepha.stop();
  });
});
