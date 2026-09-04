import { Alepha, AlephaError, z } from "alepha";
import { NodeHttpServerProvider } from "alepha/server";
import { describe, it } from "vitest";
import WebSocket from "ws";

import { AlephaWebSocket } from "../index.ts";
import { $channel } from "../primitives/$channel.ts";
import { $room } from "../primitives/$room.ts";
import { $websocket } from "../primitives/$websocket.ts";

/**
 * `authorize` is the pre-accept hook for an endpoint whose credential names a
 * MACHINE rather than a person. It decides the connection before any socket
 * exists, and it decides the room too, so the client's `?roomId=` cannot be
 * used to enter a room the credential does not own.
 *
 * Before this hook the only pre-accept seam was `resolveUserId`, which runs
 * the security realm, and the room came from the URL on both engines: any
 * signed-in user could open `?roomId=<somebody else's room>` and be admitted
 * before `onConnect` or `onJoin` had a chance to refuse, and a room-scoped
 * `emit()` reaches every socket in the room in between. Epic #20's estates
 * are what gave that hole a name.
 */

const serverMessage = z.object({ content: z.text() });
const clientMessage = z.object({ content: z.text() });

const SECRET = "Bearer machine-secret";

function waitForOpen(ws: WebSocket) {
  return new Promise<void>((resolve) => ws.on("open", resolve));
}

function waitForUnexpectedResponse(ws: WebSocket): Promise<number | undefined> {
  return new Promise((resolve) =>
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode)),
  );
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const wsUrl = (alepha: Alepha, path: string) =>
  alepha.inject(NodeHttpServerProvider).hostname.replace("http://", "ws://") +
  path;

describe("$websocket authorize", () => {
  it("refuses the handshake with 401 when authorize returns undefined", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaWebSocket);

    class Controller {
      ch = $channel({
        path: "/ws/authorize-refuse",
        schema: { in: serverMessage, out: clientMessage },
      });

      ws = $websocket({
        channel: this.ch,
        handler: async () => {},
        authorize: async () => undefined,
      });
    }

    alepha.inject(Controller);
    await alepha.start();

    const ws = new WebSocket(wsUrl(alepha, "/ws/authorize-refuse"));
    expect(await waitForUnexpectedResponse(ws)).toBe(401);

    await alepha.stop();
  });

  it("names the room from the credential and ignores the URL's roomId", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaWebSocket);
    const connects: Array<{ roomIds: string[]; userId?: string }> = [];

    class Controller {
      ch = $channel({
        path: "/ws/authorize-room",
        schema: { in: serverMessage, out: clientMessage },
      });

      ws = $websocket({
        channel: this.ch,
        handler: async () => {},
        authorize: async ({ headers }) =>
          headers.authorization === SECRET ? { roomId: "estate-1" } : undefined,
        onConnect: ({ roomIds, userId }) => {
          connects.push({ roomIds, userId });
        },
      });
    }

    const controller = alepha.inject(Controller);
    await alepha.start();

    // The client asks for somebody else's room. The credential says otherwise.
    const ws = new WebSocket(wsUrl(alepha, "/ws/authorize-room?roomId=other"), {
      headers: { authorization: SECRET },
    } as any);
    const received: string[] = [];
    ws.on("message", (data: Buffer) => received.push(data.toString("utf8")));
    await waitForOpen(ws);
    await delay(100);

    expect(connects).toEqual([{ roomIds: ["estate-1"], userId: undefined }]);

    await controller.ws.emit({
      roomId: "other",
      message: { content: "for the forged room" },
    });
    await controller.ws.emit({
      roomId: "estate-1",
      message: { content: "for the real room" },
    });
    await delay(200);

    expect(received.join("\n")).toContain("for the real room");
    expect(received.join("\n")).not.toContain("for the forged room");

    ws.close();
    await alepha.stop();
  });

  it("answers 503, not 401, when authorize itself fails", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaWebSocket);

    class Controller {
      ch = $channel({
        path: "/ws/authorize-throws",
        schema: { in: serverMessage, out: clientMessage },
      });

      ws = $websocket({
        channel: this.ch,
        handler: async () => {},
        authorize: async () => {
          throw new AlephaError("the credential store is down");
        },
      });
    }

    alepha.inject(Controller);
    await alepha.start();

    // A 401 would tell a machine its credential was revoked, and a well-behaved
    // client stops retrying on that. An outage is not a revocation.
    const ws = new WebSocket(wsUrl(alepha, "/ws/authorize-throws"));
    expect(await waitForUnexpectedResponse(ws)).toBe(503);

    await alepha.stop();
  });

  it("refuses authorize together with secure at registration", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaWebSocket);

    class Controller {
      ch = $channel({
        path: "/ws/authorize-and-secure",
        schema: { in: serverMessage, out: clientMessage },
      });

      ws = $websocket({
        channel: this.ch,
        handler: async () => {},
        secure: true,
        authorize: async () => ({ roomId: "x" }),
      });
    }

    // The primitive registers itself the moment the controller is built, so
    // the refusal lands at `inject`, before `start()`. Either point is the
    // boot, which is where a declaration error belongs.
    await expect(
      (async () => {
        alepha.inject(Controller);
        await alepha.start();
      })(),
    ).rejects.toThrow(AlephaError);
  });
});

describe("$room authorize", () => {
  it("joins the socket to the room the credential names, not the one the URL asked for", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaWebSocket);
    const joined: Array<{ roomId: string; userId?: string }> = [];

    class Controller {
      ch = $channel({
        path: "/ws/authorize-world",
        schema: { in: serverMessage, out: clientMessage },
      });

      room = $room({
        channel: this.ch,
        state: () => ({}),
        authorize: async ({ headers }) =>
          headers.authorization === SECRET ? { roomId: "world-1" } : undefined,
        onJoin: (room, connection) => {
          joined.push({ roomId: room.roomId, userId: connection.userId });
        },
      });
    }

    alepha.inject(Controller);
    await alepha.start();

    const ws = new WebSocket(
      wsUrl(alepha, "/ws/authorize-world?roomId=forged"),
      {
        headers: { authorization: SECRET },
      } as any,
    );
    await waitForOpen(ws);
    await delay(100);

    expect(joined).toEqual([{ roomId: "world-1", userId: undefined }]);

    ws.close();
    await alepha.stop();
  });

  it("refuses a room handshake with 401 when authorize returns undefined", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaWebSocket);

    class Controller {
      ch = $channel({
        path: "/ws/authorize-world-refuse",
        schema: { in: serverMessage, out: clientMessage },
      });

      room = $room({
        channel: this.ch,
        state: () => ({}),
        authorize: async () => undefined,
      });
    }

    alepha.inject(Controller);
    await alepha.start();

    const ws = new WebSocket(wsUrl(alepha, "/ws/authorize-world-refuse"));
    expect(await waitForUnexpectedResponse(ws)).toBe(401);

    await alepha.stop();
  });
});
