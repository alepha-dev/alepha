import { Alepha, z } from "alepha";
import { $issuer, $secure, type UserAccount } from "alepha/security";
import { ServerProvider } from "alepha/server";
import { $auth, ServerAuthProvider } from "alepha/server/auth";
import { describe, it } from "vitest";
import WebSocket from "ws";

import { AlephaWebSocket } from "../index.ts";
import { $channel } from "../primitives/$channel.ts";
import { $websocket } from "../primitives/$websocket.ts";

/**
 * A browser's WebSocket carries no `Authorization`: its session cookie is
 * its only credential, and the cookie is read only for an upgrade whose
 * `Origin` is this host. Node's handshake used to forward neither `Origin`
 * nor `Host`, so every cookie upgrade was anonymous and a `$secure` socket
 * refused every signed-in browser. These specs run a real upgrade with a
 * real session cookie, minted by signing in.
 */
class App {
  issuer = $issuer({
    secret: "a-websocket-cookie-secret",
    roles: [{ name: "user", default: true, permissions: [{ name: "*" }] }],
  });

  auth = $auth({
    name: "credentials",
    issuer: this.issuer,
    credentials: {
      account: async (body) =>
        ({ id: body.username, name: body.username }) as UserAccount,
    },
  });

  channel = $channel({
    path: "/ws/cookie",
    schema: {
      in: z.object({ userId: z.text(), roomId: z.text() }),
      out: z.object({ type: z.text() }),
    },
  });

  socket = $websocket({
    channel: this.channel,
    use: [$secure()],
    // Only the room named after the user: a stand-in for "a member of this
    // private room".
    canJoin: ({ userId, roomId }) => roomId === `room-of-${userId}`,
    handler: async ({ userId, roomId, reply }) => {
      await reply({ message: { userId: userId ?? "", roomId } });
    },
  });
}

const boot = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(App);
  alepha.with(ServerAuthProvider);
  alepha.with(AlephaWebSocket);
  await alepha.start();

  const hostname = alepha.inject(ServerProvider).hostname;
  const host = new URL(hostname).host;

  const signIn = async (username: string) => {
    const response = await fetch(
      `${hostname}/_auth/token?provider=credentials`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password: "secret" }),
      },
    );
    return response.headers
      .getSetCookie()
      .map((line) => line.split(";")[0])
      .join("; ");
  };

  /**
   * Open a socket the way a browser does: the cookie, and the page's origin.
   * Resolves with the first frame the server answers, or the status of a
   * refused upgrade.
   */
  const connect = (options: {
    cookie: string;
    origin?: string;
    roomId: string;
  }) =>
    new Promise<{ status?: number; frame?: any }>((resolve) => {
      const ws = new WebSocket(
        `ws://${host}/ws/cookie?roomId=${options.roomId}`,
        {
          headers: {
            cookie: options.cookie,
            ...(options.origin ? { origin: options.origin } : {}),
          },
        },
      );
      // A refused upgrade answers a plain status, then `ws` reports the
      // aborted handshake as an error: the status is the result.
      ws.on("error", () => {});
      ws.on("unexpected-response", (_request, response) => {
        resolve({ status: response.statusCode });
      });
      ws.on("open", () => ws.send(JSON.stringify({ type: "who" })));
      ws.on("message", (data) => {
        resolve({ frame: JSON.parse((data as Buffer).toString()) });
        ws.close();
      });
    });

  return { alepha, hostname, signIn, connect };
};

describe("a WebSocket upgrade carrying a session cookie", () => {
  it("is signed in when its origin is this host", async ({ expect }) => {
    const { hostname, signIn, connect } = await boot();
    const cookie = await signIn("ada");

    const result = await connect({
      cookie,
      origin: hostname,
      roomId: "room-of-ada",
    });

    expect(result.frame).toMatchObject({
      userId: "ada",
      roomId: "room-of-ada",
    });
  });

  it("is refused by $secure when it comes from another site", async ({
    expect,
  }) => {
    const { signIn, connect } = await boot();
    const cookie = await signIn("ada");

    const result = await connect({
      cookie,
      origin: "https://evil.example",
      roomId: "room-of-ada",
    });

    expect(result.status).toBe(401);
  });

  it("is refused with a 403 for a room canJoin says is not the user's", async ({
    expect,
  }) => {
    const { hostname, signIn, connect } = await boot();
    const cookie = await signIn("ada");

    const result = await connect({
      cookie,
      origin: hostname,
      roomId: "room-of-grace",
    });

    expect(result.status).toBe(403);
  });

  it("is refused without a session", async ({ expect }) => {
    const { hostname, connect } = await boot();

    const result = await connect({
      cookie: "",
      origin: hostname,
      roomId: "room-of-ada",
    });

    expect(result.status).toBe(401);
  });
});

describe("canJoin", () => {
  it("cannot be declared together with authorize", ({ expect }) => {
    class Both {
      channel = $channel({
        path: "/ws/both",
        schema: { in: z.object({}), out: z.object({}) },
      });

      socket = $websocket({
        channel: this.channel,
        authorize: () => ({ roomId: "x" }),
        canJoin: () => true,
        handler: () => {},
      });
    }

    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with(AlephaWebSocket);

    expect(() => alepha.with(Both)).toThrow(/authorize and canJoin/);
  });
});
