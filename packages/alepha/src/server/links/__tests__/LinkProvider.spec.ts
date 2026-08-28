import { Alepha, z } from "alepha";
import { $action, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { LinkProvider, ServerLinksProvider } from "../index.ts";

class App {
  ping = $action({
    schema: {
      response: z.object({
        pong: z.boolean(),
      }),
    },
    handler: () => {
      return { pong: true };
    },
  });
}

describe("LinkProvider", () => {
  it("should execute action through local handler", async ({ expect }) => {
    const alepha = Alepha.create().with(App).with(ServerLinksProvider);
    await alepha.start();

    const app = alepha.inject(LinkProvider).client<App>();

    expect(await app.ping()).toStrictEqual({ pong: true });
  });

  it("should expose links endpoint with new registry format", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(App).with(ServerLinksProvider);
    await alepha.start();

    const res = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/_links`,
    );

    const data = await res.json();

    expect(data).toStrictEqual({
      prefix: "/api",
      actions: {
        ping: {
          path: "/ping",
        },
      },
    });
  });

  it("should return actions as a map (O(1) lookup by name)", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(App).with(ServerLinksProvider);
    await alepha.start();

    const res = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/_links`,
    );
    const data = await res.json();

    // actions is an object, not an array
    expect(typeof data.actions).toBe("object");
    expect(Array.isArray(data.actions)).toBe(false);
    expect(data.actions.ping).toBeDefined();
    expect(data.actions.ping.path).toBe("/ping");
  });

  it("should omit method for GET actions", async ({ expect }) => {
    class GetApp {
      getUsers = $action({
        path: "/users",
        schema: { response: z.array(z.text()) },
        handler: () => ["user1"],
      });
    }

    const alepha = Alepha.create().with(GetApp).with(ServerLinksProvider);
    await alepha.start();

    const res = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/_links`,
    );
    const data = await res.json();

    expect(data.actions.getUsers.method).toBeUndefined();
  });

  it("should include method for non-GET actions", async ({ expect }) => {
    class PostApp {
      createUser = $action({
        method: "POST",
        path: "/users",
        schema: {
          body: z.object({ name: z.text() }),
          response: z.text(),
        },
        handler: ({ body }) => body.name,
      });
    }

    const alepha = Alepha.create().with(PostApp).with(ServerLinksProvider);
    await alepha.start();

    const res = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/_links`,
    );
    const data = await res.json();

    expect(data.actions.createUser.method).toBe("POST");
  });

  it("should not include definitions or schema refs in registry", async ({
    expect,
  }) => {
    class SchemaApp {
      getUser = $action({
        path: "/users/:id",
        schema: { response: z.object({ id: z.integer(), name: z.text() }) },
        handler: () => ({ id: 1, name: "John" }),
      });
      updateUser = $action({
        method: "PUT",
        path: "/users/:id",
        schema: {
          body: z.object({ name: z.text() }),
          response: z.object({ id: z.integer(), name: z.text() }),
        },
        handler: () => ({ id: 1, name: "John" }),
      });
    }

    const alepha = Alepha.create().with(SchemaApp).with(ServerLinksProvider);
    await alepha.start();

    const res = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/_links`,
    );
    const data = await res.json();

    expect(data.definitions).toBeUndefined();
    expect(data.actions.getUser.body).toBeUndefined();
    expect(data.actions.getUser.response).toBeUndefined();
    expect(data.actions.updateUser.body).toBeUndefined();
    expect(data.actions.updateUser.response).toBeUndefined();
  });

  it("should not include group or rawSchema in wire format", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(App).with(ServerLinksProvider);
    await alepha.start();

    const res = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/_links`,
    );
    const data = await res.json();

    const action = data.actions.ping;
    expect(action.group).toBeUndefined();
    expect(action.rawSchema).toBeUndefined();
    expect(action.name).toBeUndefined(); // name is the key, not a field
    expect(action.requestBodyType).toBeUndefined();
  });

  it("should throw on duplicate local action names", async ({ expect }) => {
    class DuplicateApp {
      ping = $action({
        handler: () => "first",
      });
      ping2 = $action({
        name: "ping",
        handler: () => "second",
      });
    }

    const alepha = Alepha.create().with(DuplicateApp).with(ServerLinksProvider);

    try {
      await alepha.start();
      expect.unreachable("should have thrown");
    } catch (error: any) {
      // The provider's own error, not a wrapper around it: a failing hook
      // used to be wrapped on `start()`'s logging path and no longer is,
      // so the message is on the error rather than on its cause.
      expect(error.message).toMatch(/Duplicate action name "ping"/);
    }
  });
});
