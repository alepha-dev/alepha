import { Alepha, AlephaError, z } from "alepha";
import { $action, BadRequestError, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";
import { ServerLinksProvider } from "../index.ts";

describe("POST /api/_batch", () => {
  it("should execute multiple actions in a single request", async ({
    expect,
  }) => {
    class App {
      ping = $action({
        schema: { response: z.text() },
        handler: () => "pong",
      });
      echo = $action({
        schema: {
          body: z.object({ message: z.text() }),
          response: z.text(),
        },
        handler: ({ body }) => body.message,
      });
    }

    const alepha = Alepha.create().with(App).with(ServerLinksProvider);
    await alepha.start();

    const res = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/_batch`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          { action: "ping" },
          { action: "echo", body: { message: "hello" } },
        ]),
      },
    );

    const data = await res.json();

    expect(data).toHaveLength(2);
    expect(data[0]).toStrictEqual({
      action: "ping",
      status: 200,
      data: "pong",
    });
    expect(data[1]).toStrictEqual({
      action: "echo",
      status: 200,
      data: "hello",
    });
  });

  it("should return error for unknown action without affecting others", async ({
    expect,
  }) => {
    class App {
      ping = $action({
        schema: { response: z.text() },
        handler: () => "pong",
      });
    }

    const alepha = Alepha.create().with(App).with(ServerLinksProvider);
    await alepha.start();

    const res = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/_batch`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ action: "ping" }, { action: "nonExistent" }]),
      },
    );

    const data = await res.json();

    expect(data).toHaveLength(2);
    expect(data[0]).toStrictEqual({
      action: "ping",
      status: 200,
      data: "pong",
    });
    expect(data[1].action).toBe("nonExistent");
    expect(data[1].status).toBeGreaterThanOrEqual(400);
    expect(data[1].error).toBeDefined();
  });

  it("should return ordered results matching input order", async ({
    expect,
  }) => {
    class App {
      slow = $action({
        schema: { response: z.text() },
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return "slow";
        },
      });
      fast = $action({
        schema: { response: z.text() },
        handler: () => "fast",
      });
    }

    const alepha = Alepha.create().with(App).with(ServerLinksProvider);
    await alepha.start();

    const res = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/_batch`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ action: "slow" }, { action: "fast" }]),
      },
    );

    const data = await res.json();

    // Results should maintain input order even though fast finishes first
    expect(data[0]).toStrictEqual({
      action: "slow",
      status: 200,
      data: "slow",
    });
    expect(data[1]).toStrictEqual({
      action: "fast",
      status: 200,
      data: "fast",
    });
  });

  it("should reject batches exceeding max size", async ({ expect }) => {
    class App {
      ping = $action({
        handler: () => "pong",
      });
    }

    const alepha = Alepha.create().with(App).with(ServerLinksProvider);
    await alepha.start();

    const entries = Array.from({ length: 21 }, () => ({ action: "ping" }));

    const res = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/_batch`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(entries),
      },
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("should not leak a 5xx message in production", async ({ expect }) => {
    class App {
      boom = $action({
        schema: { response: z.text() },
        handler: () => {
          throw new AlephaError(
            "connect ECONNREFUSED db.internal:5432 (user=admin password=hunter2)",
          );
        },
      });
    }

    const alepha = Alepha.create({
      env: {
        NODE_ENV: "production",
        SERVER_PORT: 0,
        APP_SECRET: "test-secret",
      },
    })
      .with(App)
      .with(ServerLinksProvider);
    await alepha.start();

    const res = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/_batch`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ action: "boom" }]),
      },
    );

    const data = await res.json();

    expect(data[0].status).toBe(500);
    expect(data[0].error).toBe("Internal Server Error");
    expect(JSON.stringify(data)).not.toContain("hunter2");
    expect(JSON.stringify(data)).not.toContain("db.internal");

    await alepha.stop();
  });

  it("should keep a 4xx message in production (client-facing)", async ({
    expect,
  }) => {
    class App {
      nope = $action({
        schema: { response: z.text() },
        handler: () => {
          throw new BadRequestError("age must be a positive integer");
        },
      });
    }

    const alepha = Alepha.create({
      env: {
        NODE_ENV: "production",
        SERVER_PORT: 0,
        APP_SECRET: "test-secret",
      },
    })
      .with(App)
      .with(ServerLinksProvider);
    await alepha.start();

    const res = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/_batch`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ action: "nope" }]),
      },
    );

    const data = await res.json();

    expect(data[0].status).toBe(400);
    expect(data[0].error).toContain("age");

    await alepha.stop();
  });

  it("should handle actions with params", async ({ expect }) => {
    class App {
      getUser = $action({
        path: "/users/:id",
        schema: {
          params: z.object({ id: z.text() }),
          response: z.object({ id: z.text(), name: z.text() }),
        },
        handler: ({ params }) => ({ id: params.id, name: `User ${params.id}` }),
      });
    }

    const alepha = Alepha.create().with(App).with(ServerLinksProvider);
    await alepha.start();

    const res = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/_batch`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          { action: "getUser", params: { id: "1" } },
          { action: "getUser", params: { id: "2" } },
        ]),
      },
    );

    const data = await res.json();

    expect(data).toHaveLength(2);
    expect(data[0]).toStrictEqual({
      action: "getUser",
      status: 200,
      data: { id: "1", name: "User 1" },
    });
    expect(data[1]).toStrictEqual({
      action: "getUser",
      status: 200,
      data: { id: "2", name: "User 2" },
    });
  });
});
