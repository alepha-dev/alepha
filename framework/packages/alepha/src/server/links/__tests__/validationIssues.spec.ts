import { Alepha, SchemaValidationError, z } from "alepha";
import { AlephaSecurity } from "alepha/security";
import {
  $action,
  HttpClient,
  HttpError,
  ServerProvider,
  ValidationError,
} from "alepha/server";
import { describe, it } from "vitest";

import {
  AlephaServerLinks,
  AlephaServerLinksClient,
  LinkProvider,
} from "../index.ts";
import { BatchCollector } from "../services/BatchCollector.ts";

/**
 * A 400 names the part of the request it refused and every failing field in
 * it, whether request validation raised it or a handler did (#Q3201), and a
 * remote client rebuilds it as `ValidationError` with both intact, alone or
 * batched.
 */
class Forms {
  create = $action({
    path: "/quests",
    method: "POST",
    schema: {
      body: z.object({ title: z.text(), email: z.email() }),
      response: z.text(),
    },
    handler: ({ body }) => {
      if (body.email === "taken@example.com") {
        throw new ValidationError({
          part: "body",
          issues: [{ path: "/email", message: "Email already in use" }],
        });
      }
      return body.title;
    },
  });

  list = $action({
    path: "/quests",
    method: "GET",
    schema: {
      query: z.object({ limit: z.integer() }),
      response: z.text(),
    },
    handler: () => "listed",
  });

  read = $action({
    path: "/quests/:id",
    method: "GET",
    schema: {
      params: z.object({ id: z.integer() }),
      response: z.text(),
    },
    handler: () => "read",
  });

  tenant = $action({
    path: "/tenant",
    method: "GET",
    schema: {
      headers: z.object({ "x-tenant": z.text() }),
      response: z.text(),
    },
    handler: () => "tenant",
  });

  broken = $action({
    path: "/broken",
    method: "POST",
    schema: { response: z.text() },
    handler: () => {
      throw new SchemaValidationError({ message: "bad", path: "/x" });
    },
  });
}

const serve = async (env: Record<string, unknown> = {}) => {
  const alepha = Alepha.create({ env: { SERVER_PORT: 0, ...env } })
    .with(AlephaServerLinks)
    .with(AlephaSecurity)
    .with(Forms);
  await alepha.start();
  return { alepha, hostname: alepha.inject(ServerProvider).hostname };
};

/**
 * Wrapped in an object: the client is a proxy answering every property,
 * `then` included, so returning it bare from an async function would make
 * `await` call it as an action.
 */
const remote = async (hostname: string) => {
  const alepha = Alepha.create().with(AlephaServerLinksClient);
  await alepha.start();
  return { client: alepha.inject(LinkProvider).client<Forms>({ hostname }) };
};

const rejection = async (call: Promise<unknown>) => {
  try {
    await call;
  } catch (error) {
    return error as ValidationError;
  }
  throw new Error("expected the call to fail");
};

describe("ValidationError's part and issues", () => {
  it("names the body and every failing field of it", async ({ expect }) => {
    const { hostname } = await serve();
    const { client } = await remote(hostname);

    const error = await rejection(
      client.create({ body: { email: "nope" } as any }),
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.status).toBe(400);
    expect(error.data.part).toBe("body");
    expect(error.data.issues).toEqual([
      { path: "/title", message: "'title' is required" },
      { path: "/email", message: expect.any(String) },
    ]);
    // `details` and the message keep what they said before.
    expect(error.data.details).toBe("/title");
    expect(error.message).toBe(
      "Invalid request body: 'title' is required (/title)",
    );
  });

  it("names the query", async ({ expect }) => {
    const { hostname } = await serve();
    const { client } = await remote(hostname);

    const error = await rejection(
      client.list({ query: { limit: "many" as any } }),
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.data.part).toBe("query");
    expect(error.data.issues?.map((issue) => issue.path)).toEqual(["/limit"]);
  });

  it("names the params", async ({ expect }) => {
    const { hostname } = await serve();
    const { client } = await remote(hostname);

    const error = await rejection(
      client.read({ params: { id: "abc" as any } }),
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.data.part).toBe("params");
    expect(error.data.issues?.map((issue) => issue.path)).toEqual(["/id"]);
  });

  it("names the headers", async ({ expect }) => {
    const { hostname } = await serve();
    const { client } = await remote(hostname);

    const error = await rejection(client.tenant());

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.data.part).toBe("headers");
    expect(error.data.issues).toEqual([
      { path: "/x-tenant", message: "'x-tenant' is required" },
    ]);
  });

  it("answers a handler's field refusal with the same 400", async ({
    expect,
  }) => {
    const { hostname } = await serve();
    const { client } = await remote(hostname);

    const error = await rejection(
      client.create({ body: { title: "t", email: "taken@example.com" } }),
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.status).toBe(400);
    expect(error.data.part).toBe("body");
    expect(error.data.issues).toEqual([
      { path: "/email", message: "Email already in use" },
    ]);
  });

  it("keeps a SchemaValidationError thrown by a handler a 500", async ({
    expect,
  }) => {
    const { hostname } = await serve();
    const { client } = await remote(hostname);

    const error = await rejection(client.broken());

    expect(error).not.toBeInstanceOf(ValidationError);
    expect((error as unknown as HttpError).status).toBe(500);
  });

  it("sends only part, path and message in production, never zod's raw issue", async ({
    expect,
  }) => {
    const { hostname } = await serve({
      NODE_ENV: "production",
      APP_SECRET: "test-secret",
    });

    const response = await fetch(`${hostname}/api/quests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nope" }),
    });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.data.part).toBe("body");
    expect(json.data.issues).toHaveLength(2);
    for (const issue of json.data.issues) {
      expect(Object.keys(issue).sort()).toEqual(["message", "path"]);
    }
    expect(JSON.stringify(json)).not.toContain("invalid_type");
  });

  it("carries part and issues through a batched call", async ({ expect }) => {
    const { hostname } = await serve();
    const alepha = Alepha.create();
    const http = alepha.inject(HttpClient);
    // `BatchCollector` posts to a relative `/api/_batch`, as it does from a
    // page: point it at the real server.
    const fetchOne = http.fetch.bind(http);
    http.fetch = ((url: string, init: any) =>
      fetchOne(`${hostname}${url}`, init)) as typeof http.fetch;
    const collector = alepha.inject(BatchCollector);

    const call = (body: Record<string, any>) =>
      collector.add({
        action: "create",
        body,
        directCall: async () => {
          throw new Error("not batched");
        },
      });

    const [invalid, refused] = await Promise.allSettled([
      call({ email: "nope" }),
      call({ title: "t", email: "taken@example.com" }),
    ]);

    const first = (invalid as PromiseRejectedResult).reason;
    expect(first).toBeInstanceOf(ValidationError);
    expect(first.data.part).toBe("body");
    expect(first.data.issues.map((issue: any) => issue.path)).toEqual([
      "/title",
      "/email",
    ]);
    const second = (refused as PromiseRejectedResult).reason;
    expect(second).toBeInstanceOf(ValidationError);
    expect(second.data.issues).toEqual([
      { path: "/email", message: "Email already in use" },
    ]);
  });
});
