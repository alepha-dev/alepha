import { Alepha, z } from "alepha";
import { FileSystemProvider } from "alepha/system";
import { describe, test } from "vitest";

import { $action } from "../index.ts";

describe("$action", () => {
  test("serves the declared method and path, nothing derived", ({ expect }) => {
    class App {
      read = $action({
        method: "GET",
        path: "/items/:id",
        schema: { params: z.object({ id: z.text() }) },
        handler: () => "ok",
      });
    }

    const app = Alepha.create().inject(App);

    expect(app.read.method).toBe("GET");
    expect(app.read.path).toBe("/items/:id");
    expect(app.read.route.path).toBe("/api/items/:id");
  });

  test("refuses an untyped action missing its method or path", ({ expect }) => {
    class NoMethod {
      bare = $action({ path: "/bare", handler: () => "ok" } as any);
    }
    class NoPath {
      bare = $action({ method: "POST", handler: () => "ok" } as any);
    }

    expect(() => Alepha.create().inject(NoMethod)).toThrow(
      "Action 'bare' must declare both 'method' and 'path'.",
    );
    expect(() => Alepha.create().inject(NoPath)).toThrow(
      "Action 'bare' must declare both 'method' and 'path'.",
    );
  });

  test("should expose api", async ({ expect }) => {
    class Api {
      hello = $action({
        path: "/hello/:name",
        method: "GET",
        schema: {
          params: z.object({
            name: z.text(),
          }),
          query: z.object({
            transform: z.enum(["uppercase"]).optional(),
          }),
          response: z.object({
            message: z.text(),
          }),
        },
        handler: ({ params, query }) => {
          const message = `Hello ${params.name}`;
          if (query.transform === "uppercase") {
            return {
              message: message.toUpperCase(),
            };
          }
          return { message };
        },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(Api);
    await alepha.start();

    expect(await app.hello.run({ params: { name: "John" } })).toStrictEqual({
      message: "Hello John",
    });

    expect(
      await app.hello.run({
        params: { name: "John" },
        query: { transform: "uppercase" },
      }),
    ).toStrictEqual({
      message: "HELLO JOHN",
    });

    expect(
      await app.hello.fetch({ params: { name: "John" } }).then((it) => it.data),
    ).toStrictEqual({
      message: "Hello John",
    });

    expect(
      await app.hello
        .fetch({
          params: { name: "John" },
          query: { transform: "uppercase" },
        })
        .then((it) => it.data),
    ).toStrictEqual({
      message: "HELLO JOHN",
    });
  });

  test("should not be exposed when disabled", async ({ expect }) => {
    const alepha = Alepha.create();
    class TestApp {
      a1 = $action({ path: "/a1", method: "GET", handler: () => "ok:a1" });
      a2 = $action({
        path: "/a2",
        method: "GET",
        handler: () => "ok:a2",
        disabled: true,
      });
    }
    const app = alepha.inject(TestApp);
    await alepha.start();

    expect(await app.a1.fetch({}).then((it) => it.data)).toBe("ok:a1");
    // A 404 is an error to the client, not a text body to hand back as data.
    await expect(app.a2.fetch({})).rejects.toMatchObject({ status: 404 });
    await expect(app.a2.run({})).rejects.toThrow("Action 'a2' is disabled.");
  });

  test("should return nothing", async ({ expect }) => {
    const alepha = Alepha.create();
    class TestApp {
      test = $action({
        path: "/test",
        method: "GET",
        schema: {
          response: z.void(), // force no response
        },
        handler: () => {},
      });
    }
    const app = alepha.inject(TestApp);
    await alepha.start();

    expect(await app.test.run({})).toStrictEqual(undefined);
    expect(await app.test.fetch({}).then((it) => it.data)).toStrictEqual(
      undefined,
    );

    const response = await app.test.fetch({});
    expect(response.status).toBe(204); // No Content
  });

  test("should return an object", async ({ expect }) => {
    const alepha = Alepha.create();
    class TestApp {
      test = $action({
        path: "/test",
        method: "GET",
        schema: {
          response: z.json(),
        },
        handler: () => ({
          ok: true,
        }),
      });
    }
    const app = alepha.inject(TestApp);
    await alepha.start();

    expect(await app.test()).toStrictEqual({ ok: true });
    expect(await app.test.run({})).toStrictEqual({ ok: true });
    expect(await app.test.fetch({}).then((it) => it.data)).toStrictEqual({
      ok: true,
    });
  });

  test("should return a file", async ({ expect }) => {
    const alepha = Alepha.create();
    const fileSystem = alepha.inject(FileSystemProvider);
    class TestApp {
      test = $action({
        path: "/test",
        method: "GET",
        schema: {
          response: z.file(), // expect a file response
        },
        handler: () =>
          fileSystem.createFile({
            buffer: Buffer.from("hello"),
            name: "hello.txt",
            type: "text/plain",
          }),
      });
    }
    const app = alepha.inject(TestApp);
    await alepha.start();

    expect(await app.test().then((it) => it.text())).toBe("hello");
    expect(await app.test.run().then((it) => it.text())).toBe("hello");
    expect(await app.test.fetch({}).then((it) => it.data.text())).toBe("hello");

    const file = await app.test.run({});
    expect(file.name).toBe("hello.txt");
    expect(file.type).toBe("text/plain");
  });

  test("should filter fields", async ({ expect }) => {
    const alepha = Alepha.create();
    alepha.inject(FileSystemProvider);
    class TestApp {
      test = $action({
        method: "POST",
        path: "/test",
        schema: {
          body: z.object({
            extra: z.text(),
          }),
          response: z.string(),
        },
        handler: ({ body }) => JSON.stringify(body),
      });
    }
    const app = alepha.inject(TestApp);
    await alepha.start();

    expect(
      await app.test.run({
        body: { extra: "some extra", invalid: "nope" },
      } as any),
    ).toBe(JSON.stringify({ extra: "some extra" }));

    expect(
      await app.test
        .fetch({
          body: { extra: "some extra", invalid: "nope" },
        } as any)
        .then((it) => it.data),
    ).toBe(JSON.stringify({ extra: "some extra" }));
  });
});
