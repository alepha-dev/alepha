import { Alepha, t } from "alepha";
import { NodeHttpServerProvider } from "alepha/server";
import { test } from "vitest";
import WebSocket from "ws";
import { AlephaWebSocket } from "../../src/websocket/index.ts";
import { $channel } from "../../src/websocket/primitives/$channel.ts";
import { $websocket } from "../../src/websocket/primitives/$websocket.ts";

test("$websocket with channel-based architecture", async ({ expect }) => {
  const alepha = Alepha.create().with(AlephaWebSocket);

  const messages: any[] = [];

  class ChatController {
    // Define channel inside the class
    chatChannel = $channel({
      path: "/ws/chat",
      schema: {
        // Server → Client messages
        in: t.union([
          t.object({
            type: t.const("append"),
            content: t.text(),
            username: t.text(),
          }),
          t.object({
            type: t.const("system"),
            message: t.text(),
          }),
        ]),
        // Client → Server messages
        out: t.object({
          content: t.text(),
        }),
      },
    });

    chat = $websocket({
      channel: this.chatChannel,
      handler: async ({ connectionId, roomId, message, reply }) => {
        // Broadcast to all in room except sender
        await reply({
          message: {
            type: "append",
            content: message.content,
            username: connectionId,
          },
          exceptSelf: true,
        });
      },
    });
  }

  const controller = alepha.inject(ChatController);
  await alepha.start();

  const httpServer = alepha.inject(NodeHttpServerProvider);
  const hostname = httpServer.hostname.replace("http://", "ws://");

  // Connect two clients to the same room
  const ws1 = new WebSocket(`${hostname}/ws/chat?roomId=room-1`);
  const ws2 = new WebSocket(`${hostname}/ws/chat?roomId=room-1`);

  await Promise.all([
    new Promise((resolve) => ws1.on("open", resolve)),
    new Promise((resolve) => ws2.on("open", resolve)),
  ]);

  // Listen for messages on ws2
  ws2.on("message", (data) => {
    const message = JSON.parse(data.toString());
    messages.push(message);
  });

  // Wait a bit for connections to be established
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Send message from ws1
  ws1.send(
    JSON.stringify({
      roomId: "room-1",
      message: {
        content: "Hello from client 1!",
      },
    }),
  );

  // Wait for message to be received
  await new Promise((resolve) => setTimeout(resolve, 200));

  // ws2 should receive the message, but not ws1 (exceptSelf)
  expect(messages.length).toBe(1);
  expect(messages[0].type).toBe("append");
  expect(messages[0].content).toBe("Hello from client 1!");
  expect(messages[0].username).toContain("ws-");

  // Test emit API from server
  await controller.chat.emit({
    roomId: "room-1",
    message: {
      type: "system",
      message: "Server announcement",
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 200));

  // Both clients should receive the system message
  expect(messages.length).toBe(2);
  expect(messages[1].type).toBe("system");
  expect(messages[1].message).toBe("Server announcement");

  ws1.close();
  ws2.close();
  await alepha.stop();
});

test("$websocket room isolation", async ({ expect }) => {
  const alepha = Alepha.create().with(AlephaWebSocket);

  class ChatController {
    chatChannel = $channel({
      path: "/ws/chat",
      schema: {
        in: t.object({
          type: t.const("message"),
          content: t.text(),
        }),
        out: t.object({
          content: t.text(),
        }),
      },
    });

    chat = $websocket({
      channel: this.chatChannel,
      handler: async ({ roomId, message, reply }) => {
        await reply({
          message: {
            type: "message",
            content: message.content,
          },
        });
      },
    });
  }

  const controller = alepha.inject(ChatController);
  await alepha.start();

  const httpServer = alepha.inject(NodeHttpServerProvider);
  const hostname = httpServer.hostname.replace("http://", "ws://");

  // Connect clients to different rooms
  const room1Client = new WebSocket(`${hostname}/ws/chat?roomId=room-1`);
  const room2Client = new WebSocket(`${hostname}/ws/chat?roomId=room-2`);

  await Promise.all([
    new Promise((resolve) => room1Client.on("open", resolve)),
    new Promise((resolve) => room2Client.on("open", resolve)),
  ]);

  const room1Messages: any[] = [];
  const room2Messages: any[] = [];

  room1Client.on("message", (data) => {
    room1Messages.push(JSON.parse(data.toString()));
  });

  room2Client.on("message", (data) => {
    room2Messages.push(JSON.parse(data.toString()));
  });

  await new Promise((resolve) => setTimeout(resolve, 100));

  // Send to room-1 only
  await controller.chat.emit({
    roomId: "room-1",
    message: {
      type: "message",
      content: "Message for room 1",
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 200));

  // Only room1Client should receive the message
  expect(room1Messages.length).toBe(1);
  expect(room1Messages[0].content).toBe("Message for room 1");
  expect(room2Messages.length).toBe(0);

  room1Client.close();
  room2Client.close();
  await alepha.stop();
});
