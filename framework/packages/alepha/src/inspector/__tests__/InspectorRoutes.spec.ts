import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { AlephaInspector } from "../index.ts";
import { InspectorRoutes } from "../providers/InspectorRoutes.ts";
import { InspectorDispatcher } from "../services/InspectorDispatcher.ts";

/**
 * One request through the inspector's dispatcher, and the body as it would
 * cross the wire: `JSON` drops an `undefined` key, which is exactly the kind of
 * difference an in-memory assertion would miss.
 */
const call = async (
  alepha: Alepha,
  method: string,
  path: string,
  input: { query?: Record<string, string>; body?: unknown } = {},
) => {
  const res = await alepha
    .inject(InspectorDispatcher)
    .dispatch({ method, path, ...input });
  return { status: res.status, body: JSON.parse(JSON.stringify(res.body)) };
};

const boot = async () => {
  const alepha = Alepha.create({ env: { ALEPHA_INSPECT: "1" } }).with(
    AlephaInspector,
  );
  await alepha.start();
  return alepha;
};

describe("InspectorRoutes: matching", () => {
  it("matches a route by method, segment count and parameters", async () => {
    const alepha = await boot();
    const routes = alepha.inject(InspectorRoutes);

    const retry = routes.match("POST", "/jobs/executions/abc/retry");
    expect(retry?.route.path).toBe("/jobs/executions/:id/retry");
    expect(retry?.params).toEqual({ id: "abc" });

    const executions = routes.match("get", "/jobs/send-email/executions");
    expect(executions?.route.path).toBe("/jobs/:name/executions");
    expect(executions?.params).toEqual({ name: "send-email" });

    await alepha.stop();
  });

  it("decodes parameters and refuses an unknown method or path", async () => {
    const alepha = await boot();
    const routes = alepha.inject(InspectorRoutes);

    expect(routes.match("GET", "/db/user%20s/records")?.params).toEqual({
      entity: "user s",
    });
    expect(routes.match("DELETE", "/metadata")).toBeUndefined();
    expect(routes.match("GET", "/nope")).toBeUndefined();

    await alepha.stop();
  });
});

describe("InspectorDispatcher", () => {
  it("answers 404 for an unknown route and 400 for an invalid body", async () => {
    const alepha = await boot();

    expect((await call(alepha, "GET", "/nope")).status).toBe(404);
    expect(
      (await call(alepha, "POST", "/actions/any/call", { body: 1 })).status,
    ).toBe(400);

    await alepha.stop();
  });

  it("serializes through the response schema", async () => {
    const alepha = await boot();

    const { status, body } = await call(alepha, "GET", "/emails");

    expect(status).toBe(200);
    expect(body).toEqual({
      emails: expect.any(Array),
      directory: expect.any(String),
    });

    await alepha.stop();
  });
});

describe("InspectorRoutes: GET /logs and errors", () => {
  it("expands an error and lifts its stack, which JSON alone would lose", async () => {
    const alepha = await boot();
    const { MemoryDestinationProvider } = await import("alepha/logger");
    const memory = alepha.inject(MemoryDestinationProvider);
    const error = new Error("boom");
    memory.write("", {
      level: "ERROR",
      message: "failed",
      service: "spec",
      module: "spec",
      timestamp: 1,
      data: { error },
    });

    const { body } = await call(alepha, "GET", "/logs", {
      query: { limit: "5" },
    });
    const entry = body.logs.find((e: any) => e.message === "failed");

    expect(entry.data.error).toMatchObject({ name: "Error", message: "boom" });
    expect(entry.stack).toContain("boom");
    expect(entry.stack).toContain("InspectorRoutes.spec");

    await alepha.stop();
  });
});
