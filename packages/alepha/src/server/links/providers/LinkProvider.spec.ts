import { Alepha, t } from "alepha";
import { $action, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";
import { LinkProvider, ServerLinksProvider } from "../index.ts";

class App {
  ping = $action({
    schema: {
      response: t.object({
        pong: t.boolean(),
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
      definitions: {
        $0: '{"type":"object","required":["pong"],"properties":{"pong":{"type":"boolean"}},"additionalProperties":false}',
      },
      actions: {
        ping: {
          path: "/ping",
          response: "$0",
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
        schema: { response: t.array(t.text()) },
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
          body: t.object({ name: t.text() }),
          response: t.text(),
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

  it("should deduplicate schemas in definitions pool", async ({ expect }) => {
    const responseSchema = t.object({ id: t.integer(), name: t.text() });

    class DedupeApp {
      getUser = $action({
        path: "/users/:id",
        schema: { response: responseSchema },
        handler: () => ({ id: 1, name: "John" }),
      });
      updateUser = $action({
        method: "PUT",
        path: "/users/:id",
        schema: {
          body: t.object({ name: t.text() }),
          response: responseSchema,
        },
        handler: () => ({ id: 1, name: "John" }),
      });
    }

    const alepha = Alepha.create().with(DedupeApp).with(ServerLinksProvider);
    await alepha.start();

    const res = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/_links`,
    );
    const data = await res.json();

    // Both actions should reference the same definition for response
    expect(data.actions.getUser.response).toBe(
      data.actions.updateUser.response,
    );

    // The body schema is different, so it gets a separate definition
    expect(data.actions.updateUser.body).toBeDefined();
    expect(data.actions.updateUser.body).not.toBe(
      data.actions.updateUser.response,
    );
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
      expect(error.cause?.message).toMatch(/Duplicate action name "ping"/);
    }
  });
});
