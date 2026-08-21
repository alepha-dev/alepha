import { Alepha, z } from "alepha";
import { FileSystemProvider } from "alepha/system";
import { describe, test } from "vitest";

import { $action } from "../index.ts";

describe("$action", () => {
  test("should expose api", async ({ expect }) => {
    class Api {
      hello = $action({
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
      a1 = $action({
        handler: () => "ok:a1",
      });
      a2 = $action({
        handler: () => "ok:a2",
        disabled: true,
      });
    }
    const app = alepha.inject(TestApp);
    await alepha.start();

    expect(await app.a1.fetch({}).then((it) => it.data)).toBe("ok:a1");
    expect(await app.a2.fetch({}).then((it) => it.data)).toBe("Not Found");
    await expect(app.a2.run({})).rejects.toThrowError(
      "Action 'a2' is disabled.",
    );
  });

  test("should return nothing", async ({ expect }) => {
    const alepha = Alepha.create();
    class TestApp {
      test = $action({
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
