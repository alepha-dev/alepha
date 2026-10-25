import { $hook, Alepha, AlephaError } from "alepha";
import { ActorHostRuntime } from "alepha/actor";
import { describe, it } from "vitest";

import { CloudflareDurableObjectWebSocketServerProvider } from "../providers/CloudflareDurableObjectWebSocketServerProvider.ts";
import { WebSocketRoom } from "../providers/WebSocketRoom.ts";

class ExposedRoom extends WebSocketRoom {
  public startHost = this.ensureStarted.bind(this);
}

class Startup {
  public attempts = 0;
  public refused = true;
  public readonly start = $hook({
    on: "start",
    handler: async () => {
      this.attempts++;
      await Promise.resolve();
      if (this.refused) throw new AlephaError("startup refused");
    },
  });
}

describe("WebSocket shared host runtime", () => {
  it("shares a concurrent cold start, propagates failures and restarts after stop", async ({
    expect,
  }) => {
    const previous = (globalThis as any).__alepha;
    const app = Alepha.create().with(Startup);
    const startup = app.inject(Startup);
    const env = { HOST_FIXTURE: "bound" };
    const ctx = { acceptWebSocket: () => {}, getWebSockets: () => [] };
    const first = new ExposedRoom(ctx, env);
    const second = new ExposedRoom(ctx, env);
    (globalThis as any).__alepha = app;
    try {
      const failed = await Promise.allSettled([
        first.startHost(),
        second.startHost(),
      ]);
      expect(failed.map((result) => result.status)).toEqual([
        "rejected",
        "rejected",
      ]);
      expect(startup.attempts).toBe(1);
      expect(app.isStarted()).toBe(false);
      startup.refused = false;
      expect(
        await Promise.all([first.startHost(), second.startHost()]),
      ).toEqual([app, app]);
      expect(startup.attempts).toBe(2);
      expect(app.store.get("cloudflare.env")).toBe(env);
      expect(ActorHostRuntime.resolve(env)).toBe(app);
      await app.stop();
      await first.startHost();
      expect(startup.attempts).toBe(3);
    } finally {
      await app.stop();
      (globalThis as any).__alepha = previous;
    }
  });

  it("fails a missing namespace through the common lookup", async ({
    expect,
  }) => {
    const app = Alepha.create();
    const provider = app.inject(CloudflareDurableObjectWebSocketServerProvider);
    await expect(
      provider.emit("/ws/chat", { roomId: "lobby", message: {} }),
    ).rejects.toThrow("ALEPHA_WEBSOCKET");
    app.set("cloudflare.env", { ALEPHA_WEBSOCKET: {} });
    await expect(
      provider.callRoom("/ws/chat", "lobby", "read"),
    ).rejects.toThrow("ALEPHA_WEBSOCKET");
  });
});
