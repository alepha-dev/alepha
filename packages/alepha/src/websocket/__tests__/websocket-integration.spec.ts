import { Alepha, z } from "alepha";
import { NodeHttpServerProvider } from "alepha/server";
import { describe, test } from "vitest";
import WebSocket from "ws";
import { AlephaWebSocket } from "../index.ts";
import { $channel } from "../primitives/$channel.ts";
import { $websocket } from "../primitives/$websocket.ts";
import { NodeWebSocketServerProvider } from "../providers/NodeWebSocketServerProvider.ts";
import { RoomManager } from "../services/RoomManager.ts";

// Helpers

function waitForOpen(ws: WebSocket) {
  return new Promise<void>((resolve) => ws.on("open", resolve));
}

function collectMessages(ws: WebSocket, messages: any[] = []) {
  ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
  return messages;
}

function waitForMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) =>
    ws.once("message", (data) => resolve(JSON.parse(data.toString()))),
  );
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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Schemas used across tests
const chatInSchema = z.object({
  type: z.text(),
  content: z.text(),
});

const chatOutSchema = z.object({
  content: z.text(),
});

describe("WebSocket integration", () => {
  // -------------------------------------------------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------------------------------------------------

  describe("connection lifecycle", () => {
    test("onConnect and onDisconnect callbacks", async ({ expect }) => {
      const events: string[] = [];

      const alepha = Alepha.create().with(AlephaWebSocket);

      class Controller {
        ch = $channel({
          path: "/ws/lifecycle",
          schema: { in: chatInSchema, out: chatOutSchema },
        });

        ws = $websocket({
          channel: this.ch,
          handler: async () => {},
          onConnect: ({ connectionId, roomIds }) => {
            events.push(`connect:${connectionId}:${roomIds.join(",")}`);
          },
          onDisconnect: ({ connectionId }) => {
            events.push(`disconnect:${connectionId}`);
          },
        });
      }

      alepha.inject(Controller);
      await alepha.start();

      const hostname = alepha
        .inject(NodeHttpServerProvider)
        .hostname.replace("http://", "ws://");

      const ws = new WebSocket(`${hostname}/ws/lifecycle?roomId=lobby`);
      await waitForOpen(ws);
      await delay(100);

      expect(events.length).toBe(1);
      expect(events[0]).toMatch(/^connect:ws-\d+:lobby$/);

      ws.close();
      await delay(100);

      expect(events.length).toBe(2);
      expect(events[1]).toMatch(/^disconnect:ws-\d+$/);

      await alepha.stop();
    });

    test("default room assignment when no roomId provided", async ({
      expect,
    }) => {
      const roomIds: string[] = [];

      const alepha = Alepha.create().with(AlephaWebSocket);

      class Controller {
        ch = $channel({
          path: "/ws/default-room",
          schema: { in: chatInSchema, out: chatOutSchema },
        });

        ws = $websocket({
          channel: this.ch,
          handler: async () => {},
          onConnect: ({ roomIds: ids }) => {
            roomIds.push(...ids);
          },
        });
      }

      alepha.inject(Controller);
      await alepha.start();

      const hostname = alepha
        .inject(NodeHttpServerProvider)
        .hostname.replace("http://", "ws://");

      const ws = new WebSocket(`${hostname}/ws/default-room`);
      await waitForOpen(ws);
      await delay(100);

      expect(roomIds).toEqual(["default"]);

      ws.close();
      await alepha.stop();
    });

    test("multiple roomIds via comma-separated query param", async ({
      expect,
    }) => {
      const roomIds: string[] = [];

      const alepha = Alepha.create().with(AlephaWebSocket);

      class Controller {
        ch = $channel({
          path: "/ws/multi-room",
          schema: { in: chatInSchema, out: chatOutSchema },
        });

        ws = $websocket({
          channel: this.ch,
          handler: async () => {},
          onConnect: ({ roomIds: ids }) => {
            roomIds.push(...ids);
          },
        });
      }

      alepha.inject(Controller);
      await alepha.start();

      const hostname = alepha
        .inject(NodeHttpServerProvider)
        .hostname.replace("http://", "ws://");

      const ws = new WebSocket(`${hostname}/ws/multi-room?roomIds=a,b,c`);
      await waitForOpen(ws);
      await delay(100);

      expect(roomIds).toEqual(["a", "b", "c"]);

      ws.close();
      await alepha.stop();
    });

    test("connection cleanup removes from room manager", async ({ expect }) => {
      const alepha = Alepha.create().with(AlephaWebSocket);

      class Controller {
        ch = $channel({
          path: "/ws/cleanup",
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
      const roomManager = alepha.inject(RoomManager);

      const ws = new WebSocket(`${hostname}/ws/cleanup?roomId=test-room`);
      await waitForOpen(ws);
      await delay(100);

      expect(roomManager.getRoomConnections("test-room")).toHaveLength(1);

      ws.close();
      await delay(100);

      expect(roomManager.getRoomConnections("test-room")).toHaveLength(0);

      await alepha.stop();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------------------------------------------------

  describe("message handling", () => {
    test("handler receives correct context", async ({ expect }) => {
      let receivedContext: any = null;

      const alepha = Alepha.create().with(AlephaWebSocket);

      class Controller {
        ch = $channel({
          path: "/ws/context",
          schema: { in: chatInSchema, out: chatOutSchema },
        });

        ws = $websocket({
          channel: this.ch,
          handler: async (ctx) => {
            receivedContext = {
              connectionId: ctx.connectionId,
              roomId: ctx.roomId,
              message: ctx.message,
              hasReply: typeof ctx.reply === "function",
            };
          },
        });
      }

      alepha.inject(Controller);
      await alepha.start();

      const hostname = alepha
        .inject(NodeHttpServerProvider)
        .hostname.replace("http://", "ws://");

      const ws = new WebSocket(`${hostname}/ws/context?roomId=lobby`);
      await waitForOpen(ws);
      await delay(50);

      ws.send(
        JSON.stringify({ roomId: "lobby", message: { content: "hello" } }),
      );
      await delay(200);

      expect(receivedContext).not.toBeNull();
      expect(receivedContext.connectionId).toMatch(/^ws-\d+$/);
      expect(receivedContext.roomId).toBe("lobby");
      expect(receivedContext.message).toEqual({ content: "hello" });
      expect(receivedContext.hasReply).toBe(true);

      ws.close();
      await alepha.stop();
    });

    test("invalid message returns error to client", async ({ expect }) => {
      const alepha = Alepha.create().with(AlephaWebSocket);

      class Controller {
        ch = $channel({
          path: "/ws/validate",
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

      const ws = new WebSocket(`${hostname}/ws/validate?roomId=test`);
      await waitForOpen(ws);
      await delay(50);

      // Send message that doesn't match the out schema (missing "content")
      const errorPromise = waitForMessage(ws);
      ws.send(
        JSON.stringify({ roomId: "test", message: { invalid: "field" } }),
      );

      const response = await errorPromise;
      expect(response.error).toBeDefined();

      ws.close();
      await alepha.stop();
    });

    test("non-JSON message is ignored", async ({ expect }) => {
      let handlerCalled = false;

      const alepha = Alepha.create().with(AlephaWebSocket);

      class Controller {
        ch = $channel({
          path: "/ws/nonjson",
          schema: { in: chatInSchema, out: chatOutSchema },
        });

        ws = $websocket({
          channel: this.ch,
          handler: async () => {
            handlerCalled = true;
          },
        });
      }

      alepha.inject(Controller);
      await alepha.start();

      const hostname = alepha
        .inject(NodeHttpServerProvider)
        .hostname.replace("http://", "ws://");

      const ws = new WebSocket(`${hostname}/ws/nonjson?roomId=test`);
      await waitForOpen(ws);
      await delay(50);

      ws.send("not json {{{");
      await delay(200);

      expect(handlerCalled).toBe(false);

      ws.close();
      await alepha.stop();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Server emit targeting
  // -------------------------------------------------------------------------------------------------------------------

  describe("emit targeting", () => {
    test("emit to all connections (no targeting)", async ({ expect }) => {
      const alepha = Alepha.create().with(AlephaWebSocket);

      class Controller {
        ch = $channel({
          path: "/ws/broadcast-all",
          schema: { in: chatInSchema, out: chatOutSchema },
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

      const ws1 = new WebSocket(`${hostname}/ws/broadcast-all?roomId=a`);
      const ws2 = new WebSocket(`${hostname}/ws/broadcast-all?roomId=b`);
      await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

      const msgs1: any[] = [];
      const msgs2: any[] = [];
      collectMessages(ws1, msgs1);
      collectMessages(ws2, msgs2);
      await delay(50);

      // Emit with no room/user/connection targeting → goes to all
      await controller.ws.emit({
        message: { type: "announce", content: "global" },
      });
      await delay(200);

      expect(msgs1).toHaveLength(1);
      expect(msgs2).toHaveLength(1);
      expect(msgs1[0].content).toBe("global");
      expect(msgs2[0].content).toBe("global");

      ws1.close();
      ws2.close();
      await alepha.stop();
    });

    test("emit to specific room only", async ({ expect }) => {
      const alepha = Alepha.create().with(AlephaWebSocket);

      class Controller {
        ch = $channel({
          path: "/ws/room-target",
          schema: { in: chatInSchema, out: chatOutSchema },
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

      const wsA = new WebSocket(`${hostname}/ws/room-target?roomId=room-a`);
      const wsB = new WebSocket(`${hostname}/ws/room-target?roomId=room-b`);
      await Promise.all([waitForOpen(wsA), waitForOpen(wsB)]);

      const msgsA: any[] = [];
      const msgsB: any[] = [];
      collectMessages(wsA, msgsA);
      collectMessages(wsB, msgsB);
      await delay(50);

      await controller.ws.emit({
        roomId: "room-a",
        message: { type: "targeted", content: "for room-a" },
      });
      await delay(200);

      expect(msgsA).toHaveLength(1);
      expect(msgsA[0].content).toBe("for room-a");
      expect(msgsB).toHaveLength(0);

      wsA.close();
      wsB.close();
      await alepha.stop();
    });

    test("emit to multiple rooms", async ({ expect }) => {
      const alepha = Alepha.create().with(AlephaWebSocket);

      class Controller {
        ch = $channel({
          path: "/ws/multi-room-emit",
          schema: { in: chatInSchema, out: chatOutSchema },
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

      const ws1 = new WebSocket(`${hostname}/ws/multi-room-emit?roomId=room-1`);
      const ws2 = new WebSocket(`${hostname}/ws/multi-room-emit?roomId=room-2`);
      const ws3 = new WebSocket(`${hostname}/ws/multi-room-emit?roomId=room-3`);
      await Promise.all([waitForOpen(ws1), waitForOpen(ws2), waitForOpen(ws3)]);

      const msgs1: any[] = [];
      const msgs2: any[] = [];
      const msgs3: any[] = [];
      collectMessages(ws1, msgs1);
      collectMessages(ws2, msgs2);
      collectMessages(ws3, msgs3);
      await delay(50);

      await controller.ws.emit({
        roomIds: ["room-1", "room-2"],
        message: { type: "multi", content: "for 1 and 2" },
      });
      await delay(200);

      expect(msgs1).toHaveLength(1);
      expect(msgs2).toHaveLength(1);
      expect(msgs3).toHaveLength(0);

      ws1.close();
      ws2.close();
      ws3.close();
      await alepha.stop();
    });

    test("emit with exceptConnectionIds", async ({ expect }) => {
      const alepha = Alepha.create().with(AlephaWebSocket);
      let capturedConnId = "";

      class Controller {
        ch = $channel({
          path: "/ws/except-conn",
          schema: { in: chatInSchema, out: chatOutSchema },
        });

        ws = $websocket({
          channel: this.ch,
          handler: async () => {},
          onConnect: ({ connectionId }) => {
            // Capture the first connection ID
            if (!capturedConnId) capturedConnId = connectionId;
          },
        });
      }

      const controller = alepha.inject(Controller);
      await alepha.start();

      const hostname = alepha
        .inject(NodeHttpServerProvider)
        .hostname.replace("http://", "ws://");

      const ws1 = new WebSocket(`${hostname}/ws/except-conn?roomId=room`);
      await waitForOpen(ws1);
      await delay(100); // ensure server-side onConnect fires for ws1 first

      const ws2 = new WebSocket(`${hostname}/ws/except-conn?roomId=room`);
      await waitForOpen(ws2);
      await delay(100);

      const msgs1: any[] = [];
      const msgs2: any[] = [];
      collectMessages(ws1, msgs1);
      collectMessages(ws2, msgs2);

      // Exclude ws1 from the broadcast
      await controller.ws.emit({
        roomId: "room",
        exceptConnectionIds: [capturedConnId],
        message: { type: "selective", content: "not for ws1" },
      });
      await delay(200);

      expect(msgs1).toHaveLength(0);
      expect(msgs2).toHaveLength(1);

      ws1.close();
      ws2.close();
      await alepha.stop();
    });

    test("emit to specific connectionId", async ({ expect }) => {
      const alepha = Alepha.create().with(AlephaWebSocket);
      let targetConnId = "";

      class Controller {
        ch = $channel({
          path: "/ws/conn-target",
          schema: { in: chatInSchema, out: chatOutSchema },
        });

        ws = $websocket({
          channel: this.ch,
          handler: async () => {},
          onConnect: ({ connectionId }) => {
            targetConnId = connectionId;
          },
        });
      }

      const controller = alepha.inject(Controller);
      await alepha.start();

      const hostname = alepha
        .inject(NodeHttpServerProvider)
        .hostname.replace("http://", "ws://");

      const ws1 = new WebSocket(`${hostname}/ws/conn-target?roomId=room`);
      await waitForOpen(ws1);
      await delay(100);

      const savedConnId = targetConnId;

      const ws2 = new WebSocket(`${hostname}/ws/conn-target?roomId=room`);
      await waitForOpen(ws2);
      await delay(50);

      const msgs1: any[] = [];
      const msgs2: any[] = [];
      collectMessages(ws1, msgs1);
      collectMessages(ws2, msgs2);

      // Emit only to ws1's connectionId
      await controller.ws.emit({
        connectionId: savedConnId,
        message: { type: "direct", content: "only for ws1" },
      });
      await delay(200);

      expect(msgs1).toHaveLength(1);
      expect(msgs1[0].content).toBe("only for ws1");
      expect(msgs2).toHaveLength(0);

      ws1.close();
      ws2.close();
      await alepha.stop();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Reply from handler
  // -------------------------------------------------------------------------------------------------------------------

  describe("reply from handler", () => {
    test("reply broadcasts to room", async ({ expect }) => {
      const alepha = Alepha.create().with(AlephaWebSocket);

      class Controller {
        ch = $channel({
          path: "/ws/reply-broadcast",
          schema: { in: chatInSchema, out: chatOutSchema },
        });

        ws = $websocket({
          channel: this.ch,
          handler: async ({ message, reply }) => {
            await reply({
              message: { type: "echo", content: message.content },
            });
          },
        });
      }

      alepha.inject(Controller);
      await alepha.start();

      const hostname = alepha
        .inject(NodeHttpServerProvider)
        .hostname.replace("http://", "ws://");

      const ws1 = new WebSocket(`${hostname}/ws/reply-broadcast?roomId=room`);
      const ws2 = new WebSocket(`${hostname}/ws/reply-broadcast?roomId=room`);
      await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

      const msgs1: any[] = [];
      const msgs2: any[] = [];
      collectMessages(ws1, msgs1);
      collectMessages(ws2, msgs2);
      await delay(50);

      ws1.send(JSON.stringify({ roomId: "room", message: { content: "hi" } }));
      await delay(200);

      // Both should receive the reply (no exceptSelf)
      expect(msgs1).toHaveLength(1);
      expect(msgs2).toHaveLength(1);
      expect(msgs1[0].content).toBe("hi");

      ws1.close();
      ws2.close();
      await alepha.stop();
    });

    test("reply with exceptSelf excludes sender", async ({ expect }) => {
      const alepha = Alepha.create().with(AlephaWebSocket);

      class Controller {
        ch = $channel({
          path: "/ws/reply-except",
          schema: { in: chatInSchema, out: chatOutSchema },
        });

        ws = $websocket({
          channel: this.ch,
          handler: async ({ message, reply }) => {
            await reply({
              message: { type: "echo", content: message.content },
              exceptSelf: true,
            });
          },
        });
      }

      alepha.inject(Controller);
      await alepha.start();

      const hostname = alepha
        .inject(NodeHttpServerProvider)
        .hostname.replace("http://", "ws://");

      const ws1 = new WebSocket(`${hostname}/ws/reply-except?roomId=room`);
      const ws2 = new WebSocket(`${hostname}/ws/reply-except?roomId=room`);
      await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

      const msgs1: any[] = [];
      const msgs2: any[] = [];
      collectMessages(ws1, msgs1);
      collectMessages(ws2, msgs2);
      await delay(50);

      ws1.send(
        JSON.stringify({ roomId: "room", message: { content: "hello" } }),
      );
      await delay(200);

      // ws1 (sender) should NOT receive, ws2 should
      expect(msgs1).toHaveLength(0);
      expect(msgs2).toHaveLength(1);
      expect(msgs2[0].content).toBe("hello");

      ws1.close();
      ws2.close();
      await alepha.stop();
    });

    test("reply to a different room", async ({ expect }) => {
      const alepha = Alepha.create().with(AlephaWebSocket);

      class Controller {
        ch = $channel({
          path: "/ws/reply-room",
          schema: { in: chatInSchema, out: chatOutSchema },
        });

        ws = $websocket({
          channel: this.ch,
          handler: async ({ message, reply }) => {
            // Reply to room-b instead of the sender's room
            await reply({
              roomId: "room-b",
              message: { type: "forwarded", content: message.content },
            });
          },
        });
      }

      alepha.inject(Controller);
      await alepha.start();

      const hostname = alepha
        .inject(NodeHttpServerProvider)
        .hostname.replace("http://", "ws://");

      const wsA = new WebSocket(`${hostname}/ws/reply-room?roomId=room-a`);
      const wsB = new WebSocket(`${hostname}/ws/reply-room?roomId=room-b`);
      await Promise.all([waitForOpen(wsA), waitForOpen(wsB)]);

      const msgsA: any[] = [];
      const msgsB: any[] = [];
      collectMessages(wsA, msgsA);
      collectMessages(wsB, msgsB);
      await delay(50);

      wsA.send(
        JSON.stringify({
          roomId: "room-a",
          message: { content: "forward me" },
        }),
      );
      await delay(200);

      // room-a sender should not receive, room-b should
      expect(msgsA).toHaveLength(0);
      expect(msgsB).toHaveLength(1);
      expect(msgsB[0].content).toBe("forward me");

      wsA.close();
      wsB.close();
      await alepha.stop();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Provider API
  // -------------------------------------------------------------------------------------------------------------------

  describe("provider API", () => {
    test("getConnections returns all active connections", async ({
      expect,
    }) => {
      const alepha = Alepha.create().with(AlephaWebSocket);

      class Controller {
        ch = $channel({
          path: "/ws/get-conns",
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
      const provider = alepha.inject(NodeWebSocketServerProvider);

      const ws1 = new WebSocket(`${hostname}/ws/get-conns?roomId=room`);
      const ws2 = new WebSocket(`${hostname}/ws/get-conns?roomId=room`);
      await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);
      await delay(50);

      expect(provider.getConnections()).toHaveLength(2);

      ws1.close();
      await delay(100);

      expect(provider.getConnections()).toHaveLength(1);

      ws2.close();
      await delay(100);

      expect(provider.getConnections()).toHaveLength(0);

      await alepha.stop();
    });

    test("getRoomConnections returns connections in specific room", async ({
      expect,
    }) => {
      const alepha = Alepha.create().with(AlephaWebSocket);

      class Controller {
        ch = $channel({
          path: "/ws/room-conns",
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
      const provider = alepha.inject(NodeWebSocketServerProvider);

      const ws1 = new WebSocket(`${hostname}/ws/room-conns?roomId=vip`);
      const ws2 = new WebSocket(`${hostname}/ws/room-conns?roomId=general`);
      await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);
      await delay(50);

      expect(provider.getRoomConnections("vip")).toHaveLength(1);
      expect(provider.getRoomConnections("general")).toHaveLength(1);
      expect(provider.getRoomConnections("nonexistent")).toHaveLength(0);

      ws1.close();
      ws2.close();
      await alepha.stop();
    });

    test("closeConnection closes a specific connection", async ({ expect }) => {
      const alepha = Alepha.create().with(AlephaWebSocket);
      let connId = "";

      class Controller {
        ch = $channel({
          path: "/ws/close-conn",
          schema: { in: chatInSchema, out: chatOutSchema },
        });

        ws = $websocket({
          channel: this.ch,
          handler: async () => {},
          onConnect: ({ connectionId }) => {
            connId = connectionId;
          },
        });
      }

      alepha.inject(Controller);
      await alepha.start();

      const hostname = alepha
        .inject(NodeHttpServerProvider)
        .hostname.replace("http://", "ws://");
      const provider = alepha.inject(NodeWebSocketServerProvider);

      const ws = new WebSocket(`${hostname}/ws/close-conn?roomId=room`);
      await waitForOpen(ws);
      await delay(100);

      const closePromise = waitForClose(ws);
      await provider.closeConnection(connId, 4000, "kicked");

      const { code } = await closePromise;
      expect(code).toBe(4000);

      await alepha.stop();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------------------------------------------------------

  describe("graceful shutdown", () => {
    test("stop closes all connections", async ({ expect }) => {
      const alepha = Alepha.create().with(AlephaWebSocket);

      class Controller {
        ch = $channel({
          path: "/ws/shutdown",
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

      const ws1 = new WebSocket(`${hostname}/ws/shutdown?roomId=room`);
      const ws2 = new WebSocket(`${hostname}/ws/shutdown?roomId=room`);
      await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

      const close1 = waitForClose(ws1);
      const close2 = waitForClose(ws2);

      await alepha.stop();

      const [result1, result2] = await Promise.all([close1, close2]);
      expect(result1.code).toBe(1001);
      expect(result2.code).toBe(1001);
    });
  });
});
