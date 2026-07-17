import { describe, it } from "vitest";
import { WebSocketRoom } from "../providers/WebSocketRoom.ts";

/**
 * Minimal hibernation-socket fake, mirroring the shape of a Cloudflare
 * WebSocket accepted via `ctx.acceptWebSocket()`.
 */
class FakeWs {
  public sent: string[] = [];

  constructor(protected attachment: any) {}

  serializeAttachment(a: any) {
    this.attachment = a;
  }

  deserializeAttachment() {
    return this.attachment;
  }

  send(data: string) {
    this.sent.push(data);
  }
}

describe("WebSocketRoom", () => {
  describe("broadcastLocal", () => {
    it("sends to every socket, skipping exceptConnectionIds", ({ expect }) => {
      const a = new FakeWs({ connectionId: "a" });
      const b = new FakeWs({ connectionId: "b" });
      const c = new FakeWs({ connectionId: "c" });
      const ctx = { acceptWebSocket: () => {}, getWebSockets: () => [a, b, c] };
      const room = new WebSocketRoom(ctx, {});

      (room as any).broadcastLocal({ type: "hi" }, new Set(["b"]));

      expect(a.sent).toEqual([JSON.stringify({ type: "hi" })]);
      expect(b.sent).toEqual([]);
      expect(c.sent).toEqual([JSON.stringify({ type: "hi" })]);
    });

    it("sends string messages as-is, without re-serializing", ({ expect }) => {
      const a = new FakeWs({ connectionId: "a" });
      const ctx = { acceptWebSocket: () => {}, getWebSockets: () => [a] };
      const room = new WebSocketRoom(ctx, {});

      (room as any).broadcastLocal("raw-string-payload", new Set());

      expect(a.sent).toEqual(["raw-string-payload"]);
    });

    it("swallows send errors from closing sockets and keeps broadcasting", ({
      expect,
    }) => {
      const broken = new FakeWs({ connectionId: "broken" });
      broken.send = () => {
        throw new Error("socket closed");
      };
      const ok = new FakeWs({ connectionId: "ok" });
      const ctx = {
        acceptWebSocket: () => {},
        getWebSockets: () => [broken, ok],
      };
      const room = new WebSocketRoom(ctx, {});

      (room as any).broadcastLocal({ type: "hi" }, new Set());

      expect(ok.sent).toEqual([JSON.stringify({ type: "hi" })]);
    });
  });

  describe("broadcast", () => {
    it("fans out to non-excepted sockets via the public RPC", async ({
      expect,
    }) => {
      const a = new FakeWs({ connectionId: "a" });
      const b = new FakeWs({ connectionId: "b" });
      const ctx = { acceptWebSocket: () => {}, getWebSockets: () => [a, b] };
      const room = new WebSocketRoom(ctx, {});

      await room.broadcast({ type: "hi" }, { exceptConnectionIds: ["b"] });

      expect(a.sent).toEqual([JSON.stringify({ type: "hi" })]);
      expect(b.sent).toEqual([]);
    });
  });
});
