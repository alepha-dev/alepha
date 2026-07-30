import { Alepha, z } from "alepha";
import { AlephaSecurity, JwtProvider } from "alepha/security";
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
        secure: true,
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
        secure: true,
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
        secure: true,
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
