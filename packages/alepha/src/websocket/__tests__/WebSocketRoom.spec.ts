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

  describe("assertReplyRoom", () => {
    /**
     * On Cloudflare, `reply()` always fans out over the CURRENT Durable
     * Object's room — there is no cross-DO hop like Node's `$topic` bus.
     * A handler calling `reply({ roomId: "other" })` would otherwise
     * silently land the message in the sender's own room instead of
     * "other", so this must throw rather than pass silently.
     */
    it("throws when opts.roomId differs from the connection's room", ({
      expect,
    }) => {
      const ctx = { acceptWebSocket: () => {}, getWebSockets: () => [] };
      const room = new WebSocketRoom(ctx, {}) as any;

      expect(() => room.assertReplyRoom("other-room", "room-a")).toThrow(
        /reply\(\) cannot target a different room/,
      );
    });

    it("does not throw when opts.roomId is undefined", ({ expect }) => {
      const ctx = { acceptWebSocket: () => {}, getWebSockets: () => [] };
      const room = new WebSocketRoom(ctx, {}) as any;

      expect(() => room.assertReplyRoom(undefined, "room-a")).not.toThrow();
    });

    it("does not throw when opts.roomId matches the connection's room", ({
      expect,
    }) => {
      const ctx = { acceptWebSocket: () => {}, getWebSockets: () => [] };
      const room = new WebSocketRoom(ctx, {}) as any;

      expect(() => room.assertReplyRoom("room-a", "room-a")).not.toThrow();
    });
  });
});
