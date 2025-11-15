import { Alepha, t } from "@alepha/core";
import { NodeHttpServerProvider } from "@alepha/server";
import { test } from "vitest";
import WebSocket from "ws";
import { $websocket } from "../src/descriptors/$websocket.ts";
import { AlephaWebSockets } from "../src/index.ts";

test("should create a WebSocket endpoint and handle messages", async ({
  expect,
}) => {
  const receivedMessages: any[] = [];

  class ChatApp {
    chat = $websocket({
      path: "/chat",
      description: "Simple chat WebSocket",
      schema: {
        message: t.object({
          text: t.text(),
          user: t.text(),
        }),
      },
      handler: async ({ message, broadcast }) => {
        receivedMessages.push(message);
        await broadcast({ echo: message });
      },
    });
  }

  const alepha = Alepha.create().with(AlephaWebSockets);
  const app = alepha.inject(ChatApp);
  await alepha.start();

  // Give the server time to start
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Get the actual server hostname
  const httpServer = alepha.inject(NodeHttpServerProvider);
  const hostname = httpServer.hostname.replace("http://", "ws://");

  // Connect a WebSocket client
  const ws = new WebSocket(`${hostname}/ws/chat`);

  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          text: "Hello, World!",
          user: "Alice",
        }),
      );
    });

    ws.on("message", (data) => {
      const response = JSON.parse(data.toString());
      expect(response).toEqual({
        echo: {
          text: "Hello, World!",
          user: "Alice",
        },
      });
      resolve();
    });

    ws.on("error", (error) => {
      reject(error);
    });

    setTimeout(() => reject(new Error("Test timeout")), 5000);
  });

  expect(receivedMessages).toHaveLength(1);
  expect(receivedMessages[0]).toEqual({
    text: "Hello, World!",
    user: "Alice",
  });

  ws.close();
  await alepha.stop();
});

test("should validate messages against schema", async ({ expect }) => {
  const errors: any[] = [];

  class ValidatingApp {
    chat = $websocket({
      path: "/validate",
      schema: {
        message: t.object({
          count: t.number(),
          name: t.text(),
        }),
      },
      handler: async ({ message }) => {
        // Should not reach here with invalid message
      },
    });
  }

  const alepha = Alepha.create().with(AlephaWebSockets);
  const app = alepha.inject(ValidatingApp);
  await alepha.start();

  await new Promise((resolve) => setTimeout(resolve, 100));

  const httpServer = alepha.inject(NodeHttpServerProvider);
  const hostname = httpServer.hostname.replace("http://", "ws://");

  const ws = new WebSocket(`${hostname}/ws/validate`);

  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      // Send invalid message (missing required field)
      ws.send(
        JSON.stringify({
          count: 42,
          // missing 'name' field
        }),
      );
    });

    ws.on("message", (data) => {
      const response = JSON.parse(data.toString());
      // Should receive error message
      expect(response).toHaveProperty("error");
      expect(response.error).toContain("validation failed");
      resolve();
    });

    ws.on("error", (error) => {
      reject(error);
    });

    setTimeout(() => reject(new Error("Test timeout")), 5000);
  });

  ws.close();
  await alepha.stop();
});

test("should handle multiple connections and broadcasting", async ({
  expect,
}) => {
  class BroadcastApp {
    chat = $websocket({
      path: "/broadcast",
      handler: async ({ message, broadcast }) => {
        await broadcast(message);
      },
    });
  }

  const alepha = Alepha.create().with(AlephaWebSockets);
  const app = alepha.inject(BroadcastApp);
  await alepha.start();

  await new Promise((resolve) => setTimeout(resolve, 100));

  const httpServer = alepha.inject(NodeHttpServerProvider);
  const hostname = httpServer.hostname.replace("http://", "ws://");

  const ws1 = new WebSocket(`${hostname}/ws/broadcast`);
  const ws2 = new WebSocket(`${hostname}/ws/broadcast`);

  const messages1: any[] = [];
  const messages2: any[] = [];

  await new Promise<void>((resolve, reject) => {
    let openCount = 0;

    const checkOpen = () => {
      openCount++;
      if (openCount === 2) {
        // Both clients connected, send a message from client 1
        ws1.send(JSON.stringify({ from: "client1", text: "Hello everyone!" }));
      }
    };

    ws1.on("open", checkOpen);
    ws2.on("open", checkOpen);

    ws1.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      messages1.push(msg);
      if (messages1.length === 1 && messages2.length === 1) {
        resolve();
      }
    });

    ws2.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      messages2.push(msg);
      if (messages1.length === 1 && messages2.length === 1) {
        resolve();
      }
    });

    ws1.on("error", reject);
    ws2.on("error", reject);

    setTimeout(() => reject(new Error("Test timeout")), 5000);
  });

  // Both clients should receive the broadcast message
  expect(messages1).toHaveLength(1);
  expect(messages2).toHaveLength(1);
  expect(messages1[0]).toEqual({ from: "client1", text: "Hello everyone!" });
  expect(messages2[0]).toEqual({ from: "client1", text: "Hello everyone!" });

  ws1.close();
  ws2.close();
  await alepha.stop();
});

test("should call onConnect and onDisconnect handlers", async ({ expect }) => {
  const events: string[] = [];

  class LifecycleApp {
    chat = $websocket({
      path: "/lifecycle",
      onConnect: async (connection) => {
        events.push(`connect:${connection.id}`);
      },
      onDisconnect: async (connection) => {
        events.push(`disconnect:${connection.id}`);
      },
      handler: async () => {},
    });
  }

  const alepha = Alepha.create().with(AlephaWebSockets);
  const app = alepha.inject(LifecycleApp);
  await alepha.start();

  await new Promise((resolve) => setTimeout(resolve, 100));

  const httpServer = alepha.inject(NodeHttpServerProvider);
  const hostname = httpServer.hostname.replace("http://", "ws://");

  const ws = new WebSocket(`${hostname}/ws/lifecycle`);

  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      // Wait a bit for onConnect to be called
      setTimeout(() => {
        ws.close();
      }, 100);
    });

    ws.on("close", () => {
      // Wait a bit for onDisconnect to be called
      setTimeout(resolve, 100);
    });

    ws.on("error", reject);

    setTimeout(() => reject(new Error("Test timeout")), 5000);
  });

  expect(events).toHaveLength(2);
  expect(events[0]).toMatch(/^connect:ws-\d+$/);
  expect(events[1]).toMatch(/^disconnect:ws-\d+$/);

  await alepha.stop();
});
