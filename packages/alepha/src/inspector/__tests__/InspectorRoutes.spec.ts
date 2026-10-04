import { $atom, Alepha, z } from "alepha";
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

const testAtom = $atom({
  name: "test.devtools.atoms.settings",
  schema: z.object({ theme: z.string() }),
  default: { theme: "light" },
});

const boot = async () => {
  const alepha = Alepha.create({ env: { ALEPHA_INSPECT: "1" } }).with(
    AlephaInspector,
  );
  await alepha.start();
  return alepha;
};

const postAtom = (alepha: Alepha, body: { name: string; value: unknown }) =>
  call(alepha, "POST", "/atoms", { body });

describe("InspectorRoutes: POST /atoms", () => {
  it("accepts a valid value for a registered atom", async () => {
    const alepha = await boot();
    alepha.store.get(testAtom); // register the atom

    const resp = await postAtom(alepha, {
      name: testAtom.key,
      value: { theme: "dark" },
    });

    expect(resp.status).toBe(200);
    expect(resp.body).toStrictEqual({ success: true });

    await alepha.stop();
  });

  it("rejects an invalid value with success:false and a diagnosable message instead of a 500", async () => {
    const alepha = await boot();
    alepha.store.get(testAtom); // register the atom

    const resp = await postAtom(alepha, {
      name: testAtom.key,
      value: { theme: 42 },
    });

    // Before this fix, an invalid value threw a SchemaValidationError out of the
    // handler (an uncaught 500). The catch must turn it into a normal
    // success:false response, with a message so the devtools UI can show
    // *why* the edit was rejected instead of a silent, unexplained failure.
    expect(resp.status).toBe(200);
    const json = resp.body;
    expect(json.success).toBe(false);
    expect(typeof json.message).toBe("string");
    expect(json.message.length).toBeGreaterThan(0);

    await alepha.stop();
  });

  it("returns success:false with a message for an unknown atom name", async () => {
    const alepha = await boot();

    const resp = await postAtom(alepha, {
      name: "does.not.exist",
      value: 1,
    });

    expect(resp.status).toBe(200);
    const json = resp.body;
    expect(json.success).toBe(false);
    expect(typeof json.message).toBe("string");
    expect(json.message).toContain("does.not.exist");

    await alepha.stop();
  });
});

describe("InspectorRoutes: matching", () => {
  it("matches a static segment before a parameter that would capture it", async () => {
    const alepha = await boot();
    const routes = alepha.inject(InspectorRoutes);

    const execution = routes.match("GET", "/jobs/executions/abc");
    expect(execution?.route.path).toBe("/jobs/executions/:id");
    expect(execution?.params).toEqual({ id: "abc" });

    const executions = routes.match("get", "/jobs/send-email/executions");
    expect(executions?.route.path).toBe("/jobs/:name/executions");
    expect(executions?.params).toEqual({ name: "send-email" });

    await alepha.stop();
  });

  it("decodes parameters and refuses an unknown method or path", async () => {
    const alepha = await boot();
    const routes = alepha.inject(InspectorRoutes);

    expect(routes.match("DELETE", "/db/user%20s/records/1")?.params).toEqual({
      entity: "user s",
      id: "1",
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
      (await call(alepha, "POST", "/atoms", { body: { value: 1 } })).status,
    ).toBe(400);

    await alepha.stop();
  });

  it("serializes through the response schema", async () => {
    const alepha = await boot();
    alepha.store.get(testAtom);

    const { status, body } = await call(alepha, "GET", "/atoms/log", {
      query: { key: testAtom.key },
    });

    expect(status).toBe(200);
    expect(body).toEqual({
      entries: expect.any(Array),
      total: expect.any(Number),
    });

    await alepha.stop();
  });

  it("writes an atom into the app-level store, not a request fork", async () => {
    const alepha = await boot();
    alepha.store.get(testAtom);

    await postAtom(alepha, { name: testAtom.key, value: { theme: "dark" } });

    expect(alepha.store.get(testAtom)).toEqual({ theme: "dark" });

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
