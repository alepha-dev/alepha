import { Alepha, z } from "alepha";
import { $secure, AlephaSecurity, JwtProvider } from "alepha/security";
import { NodeHttpServerProvider } from "alepha/server";
import { describe, it } from "vitest";
import WebSocket from "ws";

import {
  AlephaWebSocket,
  NodeWebSocketServerProvider,
  WebSocketServerProvider,
} from "../index.ts";
import type { WebSocketPrimitiveOptions } from "../interfaces/WebSocketInterfaces.ts";
import { $channel } from "../primitives/$channel.ts";
import { $websocket } from "../primitives/$websocket.ts";

/**
 * A tiny concrete provider that only exercises the shared resolveUserId
 * helper and the getEndpoint contract from the abstract base class.
 */
class TestProvider extends WebSocketServerProvider {
  registerEndpoint(): void {}

  getEndpoint(): WebSocketPrimitiveOptions<any, any> | undefined {
    return undefined;
  }

  async emit(): Promise<void> {}

  getConnections() {
    return [];
  }

  getRoomConnections() {
    return [];
  }

  getUserConnections() {
    return [];
  }

  async closeConnection(): Promise<void> {}

  registerRoom(): void {}

  getRoomEndpoint() {
    return undefined;
  }

  async callRoom(): Promise<unknown> {
    return undefined;
  }

  async broadcastToRoom(): Promise<void> {}
}

describe("WebSocketServerProvider.resolveUserId", () => {
  it("returns undefined when no security module is registered", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaWebSocket);
    const provider = alepha.inject(TestProvider);
    await alepha.start();

    const userId = await provider.resolveUserId({
      url: "http://x/ws",
      headers: {},
    });

    expect(userId).toBeUndefined();
  });

  it("resolves userId from an Authorization bearer token when security is present", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaSecurity).with(AlephaWebSocket);
    const jwt = alepha.inject(JwtProvider);
    const provider = alepha.inject(TestProvider);
    await alepha.start();

    const token = await jwt.create({ sub: "user-123" }, undefined, {
      header: { typ: jwt.accessTokenTyp },
    });

    const userId = await provider.resolveUserId({
      url: "http://x/ws",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(userId).toBe("user-123");
  });
});

/**
 * The session cookie becomes a bearer token on an upgrade only from this
 * host, or from an origin CORS lists explicitly: the browser attaches it to a
 * handshake from any page (cross-site WebSocket hijacking).
 *
 * Stands in for `alepha/server/auth`, which `resolveUserId` reaches by string
 * injection under this very name: every cookie is the session of `user-123`.
 */
describe("WebSocketServerProvider.resolveUserId with a session cookie", () => {
  const boot = async (corsOrigin?: string) => {
    const alepha = Alepha.create().with(AlephaSecurity).with(AlephaWebSocket);
    const jwt = alepha.inject(JwtProvider);
    let token = "";
    class ServerAuthProvider {
      async accessTokenFromCookieHeader(): Promise<string> {
        return token;
      }
    }
    alepha.inject(ServerAuthProvider);
    if (corsOrigin) {
      alepha.store.set("alepha.server.cors.options" as any, {
        origin: corsOrigin,
      });
    }
    const provider = alepha.inject(TestProvider);
    await alepha.start();
    token = await jwt.create({ sub: "user-123" }, undefined, {
      header: { typ: jwt.accessTokenTyp },
    });

    const resolve = (headers: Record<string, string>) =>
      provider.resolveUserId({
        url: "http://app.example.com/ws",
        headers: { host: "app.example.com", cookie: "tokens=x", ...headers },
      });
    return { resolve, token };
  };

  it("converts the cookie for an upgrade from this host", async ({
    expect,
  }) => {
    const { resolve } = await boot();

    expect(await resolve({ origin: "https://app.example.com" })).toBe(
      "user-123",
    );
  });

  it("leaves an upgrade from another site anonymous", async ({ expect }) => {
    const { resolve } = await boot();

    expect(await resolve({ origin: "https://evil.example" })).toBeUndefined();
  });

  it("leaves an upgrade naming no origin anonymous", async ({ expect }) => {
    const { resolve } = await boot();

    expect(await resolve({})).toBeUndefined();
  });

  it("does not trust a wildcard CORS configuration", async ({ expect }) => {
    const { resolve } = await boot("*");

    expect(await resolve({ origin: "https://evil.example" })).toBeUndefined();
  });

  it("converts the cookie for an origin CORS lists explicitly", async ({
    expect,
  }) => {
    const { resolve } = await boot(
      "https://admin.example.com, https://studio.example.com",
    );

    expect(await resolve({ origin: "https://studio.example.com" })).toBe(
      "user-123",
    );
  });

  it("leaves an explicit Authorization untouched, whatever the origin", async ({
    expect,
  }) => {
    const { resolve, token } = await boot();

    expect(
      await resolve({
        origin: "https://elsewhere.example",
        authorization: `Bearer ${token}`,
      }),
    ).toBe("user-123");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Node provider: handshake auth + multi-room dev warning
// ---------------------------------------------------------------------------------------------------------------------

class NodeTestProvider extends NodeWebSocketServerProvider {
  public testResolveUserIdFromUpgrade = (request: any) =>
    this.resolveUserIdFromUpgrade(request);
}

function waitForOpen(ws: WebSocket) {
  return new Promise<void>((resolve) => ws.on("open", resolve));
}

function waitForClose(
  ws: WebSocket,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) =>
    ws.on("close", (code, reason) =>
      resolve({ code, reason: reason.toString() }),
    ),
  );
}

function waitForUnexpectedResponse(ws: WebSocket): Promise<number | undefined> {
  return new Promise((resolve) =>
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode)),
  );
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const chatInSchema = z.object({
  type: z.text(),
  content: z.text(),
});

const chatOutSchema = z.object({
  content: z.text(),
});

describe("NodeWebSocketServerProvider auth + rooms", () => {
  it("exposes registered endpoints via getEndpoint", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaWebSocket);
    const provider = alepha.inject(NodeWebSocketServerProvider);
    await alepha.start();
    provider.registerEndpoint({
      channel: { options: { path: "/ws/x", schema: {} } },
    } as any);
    expect(provider.getEndpoint("/ws/x")).toBeDefined();
    expect(provider.getEndpoint("/ws/none")).toBeUndefined();
    await alepha.stop();
  });

  it("warns in dev when a connection joins more than one room", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaWebSocket);
    const provider = alepha.inject(NodeWebSocketServerProvider) as any;
    await alepha.start();
    const warnings: string[] = [];
    provider.log.warn = (m: string) => warnings.push(m);
    provider.warnMultiRoom(["a", "b"]); // helper under test
    expect(warnings.some((w) => /multiple rooms/i.test(w))).toBe(true);
    await alepha.stop();
  });

  it("does not warn when a connection joins a single room", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaWebSocket);
    const provider = alepha.inject(NodeWebSocketServerProvider) as any;
    await alepha.start();
    const warnings: string[] = [];
    provider.log.warn = (m: string) => warnings.push(m);
    provider.warnMultiRoom(["a"]);
    expect(warnings.length).toBe(0);
    await alepha.stop();
  });

  it("resolves userId from a Node upgrade request via resolveUserIdFromUpgrade", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaSecurity).with(AlephaWebSocket);
    const jwt = alepha.inject(JwtProvider);
    const provider = alepha.inject(NodeTestProvider);
    await alepha.start();

    const token = await jwt.create({ sub: "user-456" }, undefined, {
      header: { typ: jwt.accessTokenTyp },
    });

    const userId = await provider.testResolveUserIdFromUpgrade({
      url: "/ws",
      headers: { host: "localhost", authorization: `Bearer ${token}` },
    });

    expect(userId).toBe("user-456");
    await alepha.stop();
  });

  it("returns undefined from resolveUserIdFromUpgrade without credentials", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaSecurity).with(AlephaWebSocket);
    const provider = alepha.inject(NodeTestProvider);
    await alepha.start();

    const userId = await provider.testResolveUserIdFromUpgrade({
      url: "/ws",
      headers: { host: "localhost" },
    });

    expect(userId).toBeUndefined();
    await alepha.stop();
  });

  it("rejects anonymous connections with 401 on a secure endpoint", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaSecurity).with(AlephaWebSocket);

    class Controller {
      ch = $channel({
        path: "/ws/secure-reject",
        schema: { in: chatInSchema, out: chatOutSchema },
      });

      ws = $websocket({
        channel: this.ch,
        handler: async () => {},
        use: [$secure()],
      });
    }

    alepha.inject(Controller);
    await alepha.start();

    const hostname = alepha
      .inject(NodeHttpServerProvider)
      .hostname.replace("http://", "ws://");
    const ws = new WebSocket(`${hostname}/ws/secure-reject`);

    const statusCode = await waitForUnexpectedResponse(ws);
    expect(statusCode).toBe(401);

    await alepha.stop();
  });

  it("accepts an authenticated connection on a secure endpoint", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaSecurity).with(AlephaWebSocket);
    const jwt = alepha.inject(JwtProvider);
    let resolvedUserId: string | undefined;

    class Controller {
      ch = $channel({
        path: "/ws/secure-accept",
        schema: { in: chatInSchema, out: chatOutSchema },
      });

      ws = $websocket({
        channel: this.ch,
        handler: async () => {},
        use: [$secure()],
        onConnect: ({ userId }) => {
          resolvedUserId = userId;
        },
      });
    }

    alepha.inject(Controller);
    await alepha.start();

    const token = await jwt.create({ sub: "user-789" }, undefined, {
      header: { typ: jwt.accessTokenTyp },
    });
    const hostname = alepha
      .inject(NodeHttpServerProvider)
      .hostname.replace("http://", "ws://");
    const ws = new WebSocket(`${hostname}/ws/secure-accept`, {
      headers: { authorization: `Bearer ${token}` },
    } as any);

    await waitForOpen(ws);
    await delay(100);

    expect(resolvedUserId).toBe("user-789");

    ws.close();
    await alepha.stop();
  });

  it("refuses with 403 a user without the role $secure asks for", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaSecurity).with(AlephaWebSocket);
    const jwt = alepha.inject(JwtProvider);

    class Controller {
      ch = $channel({
        path: "/ws/secure-role",
        schema: { in: chatInSchema, out: chatOutSchema },
      });

      ws = $websocket({
        channel: this.ch,
        handler: async () => {},
        use: [$secure({ roles: ["admin"] })],
      });
    }

    alepha.inject(Controller);
    await alepha.start();

    const token = await jwt.create({ sub: "user-no-role" }, undefined, {
      header: { typ: jwt.accessTokenTyp },
    });
    const hostname = alepha
      .inject(NodeHttpServerProvider)
      .hostname.replace("http://", "ws://");
    const ws = new WebSocket(`${hostname}/ws/secure-role`, {
      headers: { authorization: `Bearer ${token}` },
    } as any);

    const statusCode = await waitForUnexpectedResponse(ws);
    expect(statusCode).toBe(403);

    await alepha.stop();
  });

  it("still accepts anonymous connections when secure is not set", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaWebSocket);

    class Controller {
      ch = $channel({
        path: "/ws/anon-ok",
        schema: { in: chatInSchema, out: chatOutSchema },
      });

      ws = $websocket({
        channel: this.ch,
        handler: async () => {},
      });
    }

    alepha.inject(Controller);
    await alepha.start();

    const hostname = alepha
      .inject(NodeHttpServerProvider)
      .hostname.replace("http://", "ws://");
    const ws = new WebSocket(`${hostname}/ws/anon-ok`);

    await waitForOpen(ws);

    ws.close();
    await alepha.stop();
  });

  it("enforces maxConnectionsPerUser once userId is authenticated", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaSecurity).with(AlephaWebSocket);
    const jwt = alepha.inject(JwtProvider);

    class Controller {
      ch = $channel({
        path: "/ws/max-conns",
        schema: { in: chatInSchema, out: chatOutSchema },
      });

      ws = $websocket({
        channel: this.ch,
        handler: async () => {},
        use: [$secure()],
        maxConnectionsPerUser: 1,
      });
    }

    alepha.inject(Controller);
    await alepha.start();

    const token = await jwt.create({ sub: "user-max" }, undefined, {
      header: { typ: jwt.accessTokenTyp },
    });
    const hostname = alepha
      .inject(NodeHttpServerProvider)
      .hostname.replace("http://", "ws://");

    const ws1 = new WebSocket(`${hostname}/ws/max-conns`, {
      headers: { authorization: `Bearer ${token}` },
    } as any);
    await waitForOpen(ws1);
    await delay(100);

    const ws2 = new WebSocket(`${hostname}/ws/max-conns`, {
      headers: { authorization: `Bearer ${token}` },
    } as any);

    const { code } = await waitForClose(ws2);
    expect(code).toBe(1008);

    ws1.close();
    await alepha.stop();
  });
});
