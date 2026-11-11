import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { ServerProvider } from "alepha/server";
import { AlephaServerAuth, ServerAuthProvider } from "alepha/server/auth";
import { $channel, $websocket, AlephaWebSocket } from "alepha/websocket";
import { afterEach, describe, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import { $proxy, type ProxyPrimitiveOptions } from "../index.ts";

/**
 * `$proxy({ websocket: true })` on Node (#Q3351): the upgrade is forwarded
 * upstream with `node:http`, frames are piped both ways, the credential
 * default of #Q3322 applies to the handshake, and `timeout` bounds it.
 */
describe("$proxy websocket (Node)", () => {
  const cleanup: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const fn of cleanup.splice(0).toReversed()) {
      await fn();
    }
  });

  /**
   * A plain `ws` echo server, recording each handshake's headers and when a
   * connection closes.
   */
  const upstream = async () => {
    const handshakes: IncomingHttpHeaders[] = [];
    const urls: string[] = [];
    let closed!: () => void;
    const closedOnce = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const http = createServer();
    const wss = new WebSocketServer({ noServer: true });
    http.on("upgrade", (req, socket, head) => {
      handshakes.push(req.headers);
      urls.push(req.url ?? "");
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on("message", (data) =>
          ws.send(`echo:${(data as Buffer).toString()}`),
        );
        ws.on("close", () => closed());
      });
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    cleanup.push(
      () =>
        new Promise<void>((resolve) => {
          wss.close();
          http.closeAllConnections();
          http.close(() => resolve());
        }),
    );
    const port = (http.address() as AddressInfo).port;
    return {
      target: `http://127.0.0.1:${port}`,
      handshakes,
      urls,
      closed: closedOnce,
    };
  };

  /**
   * An upstream that accepts the TCP connection and never answers the
   * handshake.
   */
  const silentUpstream = async () => {
    const http: Server = createServer();
    const held: Array<{ destroy(): void }> = [];
    http.on("upgrade", (_req, socket) => {
      held.push(socket);
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    cleanup.push(
      () =>
        new Promise<void>((resolve) => {
          for (const socket of held) socket.destroy();
          http.closeAllConnections();
          http.close(() => resolve());
        }),
    );
    return `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  };

  const front = async (
    target: string,
    options: Partial<ProxyPrimitiveOptions> = {},
    configure?: (alepha: Alepha) => void,
  ) => {
    class Front {
      ws = $proxy({
        path: "/live/*",
        target,
        websocket: true,
        rewrite: (url) => {
          url.pathname = url.pathname.replace("/live", "");
        },
        ...options,
      });
    }
    const alepha = Alepha.create({ env: { APP_NAME: "FRONT" } }).with(Front);
    configure?.(alepha);
    await alepha.start();
    cleanup.push(() => alepha.stop());
    const http = alepha.inject(ServerProvider).hostname;
    return { alepha, ws: http.replace(/^http/, "ws") };
  };

  const open = (url: string, headers: Record<string, string> = {}) =>
    new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(url, { headers });
      socket.once("open", () => resolve(socket));
      socket.once("error", reject);
      socket.once("unexpected-response", (_req, res) =>
        reject(new Error(`unexpected ${res.statusCode}`)),
      );
    });

  const roundTrip = (socket: WebSocket, text: string) =>
    new Promise<string>((resolve) => {
      socket.once("message", (data) => resolve((data as Buffer).toString()));
      socket.send(text);
    });

  it("forwards the upgrade after rewrite and pipes frames both ways; a client close reaches the upstream", async ({
    expect,
  }) => {
    const up = await upstream();
    const { ws } = await front(up.target);

    const socket = await open(`${ws}/live/feed?x=1`);
    expect(await roundTrip(socket, "hello")).toBe("echo:hello");
    expect(await roundTrip(socket, "again")).toBe("echo:again");
    expect(up.urls).toEqual(["/feed?x=1"]);

    socket.close();
    await up.closed;
  });

  it("works beside alepha/websocket, whose own endpoint keeps working", async ({
    expect,
  }) => {
    const up = await upstream();
    class Own {
      chat = $channel({
        path: "/chat",
        schema: {
          in: z.object({ content: z.text() }),
          out: z.object({ content: z.text() }),
        },
      });
      live = $websocket({
        channel: this.chat,
        handler: async ({ message, reply }) => {
          await reply({ message: { content: `own:${message.content}` } });
        },
      });
    }
    const { ws } = await front(up.target, {}, (alepha) =>
      alepha.with(AlephaWebSocket).with(Own),
    );

    const proxied = await open(`${ws}/live/feed`);
    expect(await roundTrip(proxied, "through")).toBe("echo:through");

    const own = await open(`${ws}/chat?roomId=r`);
    const answer = await roundTrip(
      own,
      JSON.stringify({ roomId: "r", message: { content: "hi" } }),
    );
    expect(answer).toContain("own:hi");
    proxied.close();
    own.close();
  });

  it("sends neither Cookie nor Authorization on the handshake by default", async ({
    expect,
  }) => {
    const up = await upstream();
    const { ws } = await front(up.target);

    const socket = await open(`${ws}/live/feed`, {
      cookie: "tokens=abc",
      authorization: "Bearer client",
      "x-other": "kept",
    });
    socket.close();

    expect(up.handshakes[0].cookie).toBeUndefined();
    expect(up.handshakes[0].authorization).toBeUndefined();
    expect(up.handshakes[0]["x-other"]).toBe("kept");
  });

  it('with forward: ["authorization"], derives the bearer from the session cookie as a routed request would', async ({
    expect,
  }) => {
    const up = await upstream();
    const { ws } = await front(
      up.target,
      { forward: ["authorization"] },
      (alepha) =>
        alepha
          .with({ provide: ServerAuthProvider, use: StubSessionAuth })
          .with(AlephaServerAuth),
    );

    const socket = await open(`${ws}/live/feed`, { cookie: "tokens=abc" });
    socket.close();

    expect(up.handshakes[0].authorization).toBe("Bearer token-of:abc");
    expect(up.handshakes[0].cookie).toBeUndefined();
  });

  it("lets beforeRequest see and amend the handshake after the credentials left", async ({
    expect,
  }) => {
    const up = await upstream();
    let seenPath: string | undefined;
    let seenCookie: unknown = "unset";
    const { ws } = await front(up.target, {
      beforeRequest: (request, init) => {
        seenPath = request.url.pathname;
        seenCookie = (init.headers as Record<string, string>).cookie;
        init.headers = {
          ...(init.headers as Record<string, string>),
          authorization: "Bearer service",
        };
      },
    });

    const socket = await open(`${ws}/live/feed`, { cookie: "tokens=abc" });
    socket.close();

    expect(seenPath).toBe("/live/feed");
    expect(seenCookie).toBeUndefined();
    expect(up.handshakes[0].authorization).toBe("Bearer service");
  });

  it("answers 503 when the upstream handshake outlives the timeout", async ({
    expect,
  }) => {
    const target = await silentUpstream();
    const { alepha, ws } = await front(target, { timeout: [2, "seconds"] });
    const time = alepha.inject(DateTimeProvider);
    time.pause();

    const pending = open(`${ws}/live/feed`).catch((e: Error) => e.message);
    await new Promise((r) => setTimeout(r, 50));
    await time.travel(2_000);

    expect(await pending).toBe("unexpected 503");
  });

  it("leaves a path no websocket proxy owns to Node: the socket is closed", async ({
    expect,
  }) => {
    const up = await upstream();
    const { ws } = await front(up.target);

    const error = await open(`${ws}/elsewhere`).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect(up.handshakes).toHaveLength(0);
  });
});

/**
 * Every `tokens` cookie is the session whose access token is
 * `token-of:<value>`. The overridden methods are the ones both the routed
 * request hook (workerd) and `accessTokenFromCookieHeader` (a Node
 * handshake) go through, so the workerd spec stubs the same two.
 */
class StubSessionAuth extends ServerAuthProvider {
  protected override async cookiesToTokens(cookies: {
    req: Record<string, string>;
  }): Promise<any> {
    const value = cookies.req.tokens;
    return value ? { access_token: `token-of:${value}` } : undefined;
  }

  protected override extractAccessToken(tokens: any): any {
    return tokens.access_token;
  }
}
