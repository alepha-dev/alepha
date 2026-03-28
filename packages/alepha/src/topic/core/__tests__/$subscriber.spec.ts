import { Alepha, createMiddleware, t } from "alepha";
import { describe, expect, test } from "vitest";
import {
  $subscriber,
  $topic,
  MemoryTopicProvider,
  TopicProvider,
} from "../index.ts";

const $track = (log: string[], tag: string) =>
  createMiddleware({
    name: `$track:${tag}`,
    handler:
      ({ next }) =>
      async (...args: any[]) => {
        log.push(`${tag}:before`);
        const result = await next(...args);
        log.push(`${tag}:after`);
        return result;
      },
  });

const eventSchema = {
  payload: t.object({
    id: t.text(),
    action: t.text(),
  }),
};

describe("$subscriber middleware", () => {
  test("should apply middleware to subscriber handler", async () => {
    const log: string[] = [];

    class TestService {
      events = $topic({
        name: "test-events",
        schema: eventSchema,
      });

      listener = $subscriber({
        topic: this.events,
        use: [$track(log, "mw")],
        handler: async (message) => {
          log.push(`handler:${message.payload.id}`);
        },
      });
    }

    const app = Alepha.create().with({
      provide: TopicProvider,
      use: MemoryTopicProvider,
    });

    const svc = app.inject(TestService);
    await app.start();

    await svc.events.publish({ id: "evt1", action: "create" });

    await expect.poll(() => log.length === 3, { timeout: 1000 }).toBeTruthy();

    expect(log).toStrictEqual(["mw:before", "handler:evt1", "mw:after"]);

    await app.stop();
  });

  test("should compose multiple middleware in order", async () => {
    const log: string[] = [];

    class TestService {
      events = $topic({
        name: "test-events-multi",
        schema: eventSchema,
      });

      listener = $subscriber({
        topic: this.events,
        use: [$track(log, "first"), $track(log, "second")],
        handler: async (message) => {
          log.push(`handler:${message.payload.id}`);
        },
      });
    }

    const app = Alepha.create().with({
      provide: TopicProvider,
      use: MemoryTopicProvider,
    });

    const svc = app.inject(TestService);
    await app.start();

    await svc.events.publish({ id: "evt1", action: "create" });

    await expect.poll(() => log.length === 5, { timeout: 1000 }).toBeTruthy();

    expect(log).toStrictEqual([
      "first:before",
      "second:before",
      "handler:evt1",
      "second:after",
      "first:after",
    ]);

    await app.stop();
  });

  test("should work without middleware", async () => {
    const messages: any[] = [];

    class TestService {
      events = $topic({
        name: "test-events-plain",
        schema: eventSchema,
      });

      listener = $subscriber({
        topic: this.events,
        handler: async (message) => {
          messages.push(message.payload);
        },
      });
    }

    const app = Alepha.create().with({
      provide: TopicProvider,
      use: MemoryTopicProvider,
    });

    const svc = app.inject(TestService);
    await app.start();

    await svc.events.publish({ id: "evt1", action: "update" });

    await expect
      .poll(() => messages.length === 1, { timeout: 1000 })
      .toBeTruthy();

    expect(messages).toEqual([{ id: "evt1", action: "update" }]);

    await app.stop();
  });
});
