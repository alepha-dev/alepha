import { Alepha } from "alepha";
import { AlephaSecurity, JwtProvider } from "alepha/security";
import { AlephaWebSocket, WebSocketServerProvider } from "alepha/websocket";
import { describe, it } from "vitest";
import type { WebSocketPrimitiveOptions } from "../interfaces/WebSocketInterfaces.ts";

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

    const token = await jwt.create({ sub: "user-123" });

    const userId = await provider.resolveUserId({
      url: "http://x/ws",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(userId).toBe("user-123");
  });
});
