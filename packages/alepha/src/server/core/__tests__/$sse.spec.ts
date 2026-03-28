import { Alepha, AlephaError, t } from "alepha";
import { LinkProvider, ServerLinksProvider } from "alepha/server/links";
import { describe, test } from "vitest";
import { $sse } from "../index.ts";

describe("$sse", () => {
  test("should stream events via run()", async ({ expect }) => {
    class Api {
      events = $sse({
        schema: {
          data: t.object({
            type: t.text(),
            message: t.text(),
          }),
        },
        handler: async ({ emit, close }) => {
          emit({ type: "greeting", message: "hello" });
          emit({ type: "greeting", message: "world" });
          close();
        },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(Api);
    await alepha.start();

    const events: Array<{ type: string; message: string }> = [];
    for await (const event of app.events.run()) {
      events.push(event);
    }

    expect(events).toStrictEqual([
      { type: "greeting", message: "hello" },
      { type: "greeting", message: "world" },
    ]);
  });

  test("should have correct name and path", async ({ expect }) => {
    class Api {
      notifications = $sse({
        schema: {
          data: t.object({
            id: t.number(),
          }),
        },
        handler: async ({ close }) => {
          close();
        },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(Api);
    await alepha.start();

    expect(app.notifications.name).toBe("notifications");
    expect(app.notifications.path).toBe("/notifications");
    expect(app.notifications.method).toBe("POST");
    expect(app.notifications.prefix).toBe("/api");
  });

  test("should use custom path when provided", async ({ expect }) => {
    class Api {
      feed = $sse({
        path: "/custom/feed",
        schema: {
          data: t.object({
            value: t.text(),
          }),
        },
        handler: async ({ close }) => {
          close();
        },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(Api);
    await alepha.start();

    expect(app.feed.path).toBe("/custom/feed");
  });

  test("should append params to path", async ({ expect }) => {
    class Api {
      stream = $sse({
        schema: {
          params: t.object({
            id: t.text(),
          }),
          data: t.object({
            value: t.text(),
          }),
        },
        handler: async ({ params, emit, close }) => {
          emit({ value: `item-${params.id}` });
          close();
        },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(Api);
    await alepha.start();

    expect(app.stream.path).toBe("/stream/:id");

    const events: Array<{ value: string }> = [];
    for await (const event of app.stream.run({ params: { id: "42" } })) {
      events.push(event);
    }

    expect(events).toStrictEqual([{ value: "item-42" }]);
  });

  test("should stream via fetch() (HTTP)", async ({ expect }) => {
    class Api {
      events = $sse({
        schema: {
          data: t.object({
            seq: t.number(),
          }),
        },
        handler: async ({ emit, close }) => {
          emit({ seq: 1 });
          emit({ seq: 2 });
          emit({ seq: 3 });
          close();
        },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(Api);
    await alepha.start();

    const res = await app.events.fetch();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    const events: Array<{ seq: number }> = [];
    for await (const event of res) {
      events.push(event);
    }

    expect(events).toStrictEqual([{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
  });

  test("should propagate handler errors through the stream", async ({
    expect,
  }) => {
    class Api {
      failing = $sse({
        schema: {
          data: t.object({
            value: t.text(),
          }),
        },
        handler: async ({ emit }) => {
          emit({ value: "before-error" });
          throw new AlephaError("handler failed");
        },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(Api);
    await alepha.start();

    const events: Array<{ value: string }> = [];
    await expect(async () => {
      for await (const event of app.failing.run()) {
        events.push(event);
      }
    }).rejects.toThrowError("handler failed");

    expect(events).toStrictEqual([{ value: "before-error" }]);
  });

  test("should auto-close stream when handler finishes", async ({ expect }) => {
    class Api {
      autoClose = $sse({
        schema: {
          data: t.object({
            n: t.number(),
          }),
        },
        handler: async ({ emit }) => {
          emit({ n: 1 });
          emit({ n: 2 });
          // no explicit close() call
        },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(Api);
    await alepha.start();

    const events: Array<{ n: number }> = [];
    for await (const event of app.autoClose.run()) {
      events.push(event);
    }

    expect(events).toStrictEqual([{ n: 1 }, { n: 2 }]);
  });

  test("should be callable as a function", async ({ expect }) => {
    class Api {
      ticker = $sse({
        schema: {
          data: t.object({
            tick: t.number(),
          }),
        },
        handler: async ({ emit, close }) => {
          emit({ tick: 1 });
          close();
        },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(Api);
    await alepha.start();

    const events: Array<{ tick: number }> = [];
    for await (const event of app.ticker()) {
      events.push(event);
    }

    expect(events).toStrictEqual([{ tick: 1 }]);
  });

  test("should not be exposed when disabled", async ({ expect }) => {
    class Api {
      disabled = $sse({
        disabled: true,
        schema: {
          data: t.object({
            value: t.text(),
          }),
        },
        handler: async ({ close }) => {
          close();
        },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(Api);
    await alepha.start();

    expect(() => app.disabled.run()).toThrowError(
      "SSE endpoint 'disabled' is disabled.",
    );
  });

  test("should work via $client proxy", async ({ expect }) => {
    class Api {
      chat = $sse({
        schema: {
          body: t.object({ prompt: t.text() }),
          data: t.object({ token: t.text() }),
        },
        handler: async ({ body, emit }) => {
          emit({ token: "Hello" });
          emit({ token: body.prompt });
        },
      });
    }

    const alepha = Alepha.create().with(Api).with(ServerLinksProvider);
    await alepha.start();

    const linkProvider = alepha.inject(LinkProvider);
    const client = linkProvider.client<Api>();

    const stream = await client.chat({ body: { prompt: "world" } });
    const events: Array<{ token: string }> = [];

    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toStrictEqual([{ token: "Hello" }, { token: "world" }]);
  });

  test("should register as a link", async ({ expect }) => {
    class Api {
      chat = $sse({
        schema: {
          body: t.object({ prompt: t.text() }),
          data: t.object({ token: t.text() }),
        },
        handler: async ({ body, emit }) => {
          emit({ token: body.prompt });
        },
      });
    }

    const alepha = Alepha.create().with(Api).with(ServerLinksProvider);
    await alepha.start();

    const linkProvider = alepha.inject(LinkProvider);
    const links = linkProvider.getServerLinks();
    const chatLink = links.find((l) => l.name === "chat");

    expect(chatLink).toBeDefined();
    expect(chatLink!.kind).toBe("sse");
    expect(chatLink!.method).toBe("POST");
    expect(chatLink!.path).toBe("/chat");
  });
});
