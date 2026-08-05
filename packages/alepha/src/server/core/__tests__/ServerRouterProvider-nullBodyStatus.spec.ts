import { $hook, Alepha, z } from "alepha";
import { beforeEach, describe, it } from "vitest";
import { $route, ServerProvider } from "../index.ts";

/**
 * A handler that sets a null-body status *and* returns a value.
 *
 * The shape is easy to write and reads as harmless: the schema declares a
 * response, so the handler returns something to satisfy it, and the status is
 * set separately to mean "actually, nothing to report". Lore's outpost command
 * channel does exactly this — `reply.status = 204; return {}` on the common
 * "no work for you" branch, polled every five seconds.
 *
 * The Fetch spec forbids a body on 101/204/205/304. `new Response(body, {
 * status: 204 })` throws a TypeError on workerd, so in production this threw on
 * every poll.
 *
 * **These assertions deliberately inspect the response object the router
 * builds, not an HTTP round-trip.** A round-trip through the Node server
 * cannot catch this: Node's http layer silently omits the body for a 204, so
 * the request succeeds either way and the test passes with the bug present.
 * Only workerd rejects it, and only the built object shows the difference in
 * both runtimes.
 */
class TestApp {
  captured: Array<{ path: string; status: number; body: unknown }> = [];

  noContent = $route({
    method: "POST",
    path: "/no-content",
    schema: {
      response: z.object({ deploy: z.string().optional() }),
    },
    handler: ({ reply }) => {
      reply.status = 204;
      return {};
    },
  });

  notModified = $route({
    method: "GET",
    path: "/not-modified",
    schema: {
      response: z.object({ value: z.string().optional() }),
    },
    handler: ({ reply }) => {
      reply.status = 304;
      return { value: "ignored" };
    },
  });

  withBody = $route({
    method: "GET",
    path: "/with-body",
    schema: {
      response: z.object({ value: z.string() }),
    },
    handler: () => ({ value: "kept" }),
  });

  onResponse = $hook({
    on: "server:onResponse",
    handler: ({ request, response }) => {
      this.captured.push({
        path: new URL(request.url, "http://localhost").pathname,
        status: response.status,
        body: response.body,
      });
    },
  });
}

describe("ServerRouterProvider - null body statuses", () => {
  let alepha: Alepha;
  let app: TestApp;
  let hostname: string;

  const captureOf = (path: string) =>
    app.captured.find((entry) => entry.path === path);

  beforeEach(async () => {
    alepha = Alepha.create().with(TestApp);
    app = alepha.inject(TestApp);
    await alepha.start();
    hostname = alepha.inject(ServerProvider).hostname;
  });

  it("builds a 204 response with no body, even when the handler returned one", async ({
    expect,
  }) => {
    await fetch(`${hostname}/no-content`, { method: "POST" });

    const built = captureOf("/no-content");
    expect(built?.status).toBe(204);
    expect(built?.body).toBeUndefined();
  });

  it("builds a 304 response with no body, even when the handler returned one", async ({
    expect,
  }) => {
    await fetch(`${hostname}/not-modified`);

    const built = captureOf("/not-modified");
    expect(built?.status).toBe(304);
    expect(built?.body).toBeUndefined();
  });

  it("keeps the body on a normal 200", async ({ expect }) => {
    await fetch(`${hostname}/with-body`);

    const built = captureOf("/with-body");
    expect(built?.status).toBe(200);
    expect(built?.body).toBeDefined();
  });
});
