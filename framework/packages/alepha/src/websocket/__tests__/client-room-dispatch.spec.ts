import { Alepha, z } from "alepha";
import { NodeHttpServerProvider } from "alepha/server";
import { describe, test } from "vitest";

import { AlephaWebSocket } from "../index.ts";
import { $channel } from "../primitives/$channel.ts";
import { $websocket } from "../primitives/$websocket.ts";
import { WebSocketClient } from "../services/WebSocketClient.ts";

const inSchema = z.object({
  type: z.text(),
  content: z.text(),
});

const outSchema = z.object({
  content: z.text(),
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("WebSocketClient room dispatch", () => {
  test("should deliver a room's message only to that room's handler", async ({
    expect,
  }) => {
    // One connection serves every room the client subscribed to. The server
    // never stamped the room on outbound frames, so `handleMessage` fanned
    // each message to every handler — room A's messages landed in room B.
    const alepha = Alepha.create().with(AlephaWebSocket).with(WebSocketClient);

    class Controller {
      ch = $channel({
        path: "/ws/client-dispatch",
        schema: { in: inSchema, out: outSchema },
      });

      ws = $websocket({
        channel: this.ch,
        handler: async () => {},
      });
    }

    const controller = alepha.inject(Controller);
    await alepha.start();

    const hostname = alepha
      .inject(NodeHttpServerProvider)
      .hostname.replace("http://", "ws://");

    const client = alepha.inject(WebSocketClient);

    const roomA: any[] = [];
    const roomB: any[] = [];

    // One socket, both rooms — what the browser client does when a page has
    // two components subscribed to different rooms on the same channel.
    const url = `${hostname}/ws/client-dispatch?roomIds=room-a,room-b`;
    client.subscribe("room-a", controller.ch, (m) => roomA.push(m), { url });
    client.subscribe("room-b", controller.ch, (m) => roomB.push(m), { url });

    await delay(200);

    await controller.ws.emit({
      roomIds: ["room-a"],
      message: { type: "chat", content: "only for A" },
    });

    await delay(200);

    expect(roomA).toHaveLength(1);
    expect(roomB).toHaveLength(0);

    await alepha.stop();
  });

  test("should not leak the room marker into the handler payload", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaWebSocket).with(WebSocketClient);

    class Controller {
      ch = $channel({
        path: "/ws/client-dispatch-payload",
        schema: { in: inSchema, out: outSchema },
      });

      ws = $websocket({
        channel: this.ch,
        handler: async () => {},
      });
    }

    const controller = alepha.inject(Controller);
    await alepha.start();

    const hostname = alepha
      .inject(NodeHttpServerProvider)
      .hostname.replace("http://", "ws://");

    const client = alepha.inject(WebSocketClient);
    const received: any[] = [];

    client.subscribe("room-a", controller.ch, (m) => received.push(m), {
      url: `${hostname}/ws/client-dispatch-payload?roomIds=room-a`,
    });

    await delay(200);

    await controller.ws.emit({
      roomIds: ["room-a"],
      message: { type: "chat", content: "hello" },
    });

    await delay(200);

    expect(received).toHaveLength(1);
    expect(received[0]).toStrictEqual({ type: "chat", content: "hello" });

    await alepha.stop();
  });

  const bootChannel = async (path: string) => {
    const alepha = Alepha.create().with(AlephaWebSocket).with(WebSocketClient);
    class Controller {
      ch = $channel({ path, schema: { in: inSchema, out: outSchema } });
      ws = $websocket({ channel: this.ch, handler: async () => {} });
    }
    const controller = alepha.inject(Controller);
    await alepha.start();
    const url = `${alepha
      .inject(NodeHttpServerProvider)
      .hostname.replace("http://", "ws://")}${path}`;
    return { alepha, controller, client: alepha.inject(WebSocketClient), url };
  };

  test("joins a room subscribed while the socket is still connecting", async ({
    expect,
  }) => {
    // Two components subscribing in one render: the second reused the
    // pending connect, whose URL was built before its room existed, and
    // never joined it.
    const { alepha, controller, client, url } = await bootChannel(
      "/ws/client-connecting",
    );
    const roomA: any[] = [];
    const roomB: any[] = [];

    client.subscribe("a", controller.ch, (m) => roomA.push(m), { url });
    client.subscribe("b", controller.ch, (m) => roomB.push(m), { url });
    await delay(300);

    await controller.ws.emit({
      roomIds: ["b"],
      message: { type: "chat", content: "for b" },
    });
    await controller.ws.emit({
      roomIds: ["a"],
      message: { type: "chat", content: "for a" },
    });
    await delay(200);

    expect(roomB).toEqual([{ type: "chat", content: "for b" }]);
    expect(roomA).toEqual([{ type: "chat", content: "for a" }]);
    await alepha.stop();
  });

  test("joins a room whose id holds a comma as that one room", async ({
    expect,
  }) => {
    // `roomIds=x%2Cy` decodes to "x,y" and the server splits it on ",":
    // the socket joined x and y, never "x,y".
    const { alepha, controller, client, url } =
      await bootChannel("/ws/client-comma");
    const received: any[] = [];

    client.subscribe("x,y", controller.ch, (m) => received.push(m), { url });
    await delay(300);

    await controller.ws.emit({
      roomIds: ["x"],
      message: { type: "chat", content: "for x" },
    });
    await controller.ws.emit({
      roomIds: ["x,y"],
      message: { type: "chat", content: "for x,y" },
    });
    await delay(200);

    expect(received).toEqual([{ type: "chat", content: "for x,y" }]);
    await alepha.stop();
  });
});
