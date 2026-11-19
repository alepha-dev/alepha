import { randomUUID } from "node:crypto";

import { Alepha, z } from "alepha";
import { ServerProvider } from "alepha/server";
import { RedisTopicProvider, TopicProvider } from "alepha/topic";
import { describe, it } from "vitest";
import WebSocket from "ws";

import { AlephaWebSocket } from "../index.ts";
import { $channel } from "../primitives/$channel.ts";
import { $room } from "../primitives/$room.ts";
import { $websocket } from "../primitives/$websocket.ts";

// The compose `redis` service, as in RedisTopicProvider.spec.ts.
process.env.REDIS_URL ??= "redis://localhost:16379";

/**
 * Two Node instances of one app behind a load balancer: a client holds its
 * socket on one, the write that should reach it lands on the other.
 *
 * `$websocket.emit` goes through the topic bus, so it crosses instances.
 * `$room.broadcast` is in-process on Node: it reaches only the sockets of the
 * instance that called it. That difference is why a feature whose writes
 * arrive over HTTP, on any instance, is built on `$websocket` (#Q3923).
 */
class App {
  feedChannel = $channel({
    path: "/ws/feed",
    schema: { in: z.object({ text: z.text() }), out: z.object({}) },
  });

  worldChannel = $channel({
    path: "/ws/world",
    schema: { in: z.object({ text: z.text() }), out: z.object({}) },
  });

  feed = $websocket({ channel: this.feedChannel, handler: () => {} });

  world = $room({ channel: this.worldChannel, state: () => ({}) });
}

const start = async (name: string) => {
  const app = Alepha.create({ env: { APP_NAME: name, LOG_LEVEL: "error" } })
    .with({ provide: TopicProvider, use: RedisTopicProvider })
    .with(AlephaWebSocket)
    .with(App);
  await app.start();
  return app;
};

const connect = async (app: Alepha, path: string, roomId: string) => {
  const host = new URL(app.inject(ServerProvider).hostname).host;
  const ws = new WebSocket(`ws://${host}${path}?roomId=${roomId}`);
  const frames: string[] = [];
  ws.on("message", (data) => frames.push((data as Buffer).toString()));
  await new Promise((resolve) => ws.on("open", resolve));
  return { ws, frames };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("two Node instances sharing a Redis topic bus", () => {
  it("delivers a $websocket emit made on the other instance", async ({
    expect,
  }) => {
    const name = `ws-${randomUUID()}`;
    const a = await start(name);
    const b = await start(name);
    const client = await connect(b, "/ws/feed", "r1");

    await a.inject(App).feed.emit({ roomId: "r1", message: { text: "hi" } });

    await expect.poll(() => client.frames.join()).toContain('"hi"');
    client.ws.close();
    await a.stop();
    await b.stop();
  });

  it("does not deliver a $room broadcast made on the other instance", async ({
    expect,
  }) => {
    const name = `ws-${randomUUID()}`;
    const a = await start(name);
    const b = await start(name);
    const client = await connect(b, "/ws/world", "r1");

    await a.inject(App).world.broadcast("r1", { text: "elsewhere" });
    await b.inject(App).world.broadcast("r1", { text: "here" });

    await expect.poll(() => client.frames.join()).toContain('"here"');
    await sleep(100);
    expect(client.frames.join()).not.toContain("elsewhere");
    client.ws.close();
    await a.stop();
    await b.stop();
  });
});
