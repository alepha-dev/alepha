import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha } from "alepha";
import { AlephaServer } from "alepha/server";
import { $serve, AlephaServerStatic } from "alepha/server/static";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { $route, ServerProvider } from "../index.ts";

const staticDir = join(tmpdir(), `alepha-head-static-${Date.now()}`);

beforeAll(async () => {
  await mkdir(staticDir, { recursive: true });
  await writeFile(join(staticDir, "style.css"), "body { color: red; }");
});

afterAll(async () => {
  await rm(staticDir, { recursive: true, force: true });
});

/**
 * HEAD reaching the routes that answer GET.
 *
 * The router keys a route by `/<METHOD><path>`, so `/GET/health` was
 * unreachable by a request keyed `/HEAD/health` and every GET route in every
 * Alepha app answered HEAD with 404 - including `/health`, which is what a
 * load balancer or an uptime monitor most often checks, and most of them
 * check it with HEAD. Shipped that way since `232b7a950` (2026-01-15).
 *
 * RFC 9110: HEAD is GET without the body. The status, and every header that
 * describes the body, have to be the ones GET would have sent.
 */
describe("HEAD on a GET route", () => {
  it("answers a $route the way GET does, with no body", async () => {
    const alepha = Alepha.create();

    class TestApp {
      $route = $route({
        path: "/hello",
        handler: () => "OK",
      });
    }

    await alepha.with(TestApp).start();
    const host = alepha.inject(ServerProvider).hostname;

    const get = await fetch(`${host}/hello`);
    const head = await fetch(`${host}/hello`, { method: "HEAD" });

    expect(head.status).toBe(get.status);
    expect(await head.text()).toBe("");
    // The length of what a GET would have returned, not of what was sent.
    expect(head.headers.get("content-length")).toBe(
      get.headers.get("content-length"),
    );
    expect(head.headers.get("content-type")).toBe(
      get.headers.get("content-type"),
    );
  });

  it("answers /health, which is the reason this matters", async () => {
    const alepha = Alepha.create().with(AlephaServer);
    await alepha.start();
    const host = alepha.inject(ServerProvider).hostname;

    const head = await fetch(`${host}/health`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("carries the handler's own status and headers", async () => {
    const alepha = Alepha.create();

    class TestApp {
      $route = $route({
        path: "/teapot",
        handler: ({ reply }) => {
          reply.status = 418;
          reply.setHeader("x-brewing", "no");
          return "short and stout";
        },
      });
    }

    await alepha.with(TestApp).start();
    const host = alepha.inject(ServerProvider).hostname;

    const head = await fetch(`${host}/teapot`, { method: "HEAD" });
    expect(head.status).toBe(418);
    expect(head.headers.get("x-brewing")).toBe("no");
    expect(await head.text()).toBe("");
  });

  it("lets an explicitly declared HEAD route win over the fallback", async () => {
    const alepha = Alepha.create();

    class TestApp {
      $get = $route({
        path: "/both",
        handler: () => "from GET",
      });

      $head = $route({
        method: "HEAD",
        path: "/both",
        handler: ({ reply }) => {
          reply.setHeader("x-source", "declared");
          return "";
        },
      });
    }

    await alepha.with(TestApp).start();
    const host = alepha.inject(ServerProvider).hostname;

    const head = await fetch(`${host}/both`, { method: "HEAD" });
    expect(head.headers.get("x-source")).toBe("declared");
  });

  it("still 404s a path that answers nothing", async () => {
    const alepha = Alepha.create().with(AlephaServer);
    await alepha.start();
    const host = alepha.inject(ServerProvider).hostname;

    const head = await fetch(`${host}/nothing-here`, { method: "HEAD" });
    expect(head.status).toBe(404);
  });

  it("does not reach a route declared for another method", async () => {
    const alepha = Alepha.create();

    class TestApp {
      $route = $route({
        method: "POST",
        path: "/submit",
        handler: () => "OK",
      });
    }

    await alepha.with(TestApp).start();
    const host = alepha.inject(ServerProvider).hostname;

    // The fallback is HEAD to GET and nothing else: a POST-only path must
    // stay unreachable, or HEAD becomes a way to probe write endpoints.
    const head = await fetch(`${host}/submit`, { method: "HEAD" });
    expect(head.status).toBe(404);
  });

  it("reaches a static asset, which registers no method of its own", async () => {
    const alepha = Alepha.create().with(AlephaServerStatic);

    class TestApp {
      $serve = $serve({ root: staticDir });
    }

    await alepha.with(TestApp).start();
    const host = alepha.inject(ServerProvider).hostname;

    const get = await fetch(`${host}/style.css`);
    const head = await fetch(`${host}/style.css`, { method: "HEAD" });

    expect(get.status).toBe(200);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("content-type")).toBe(
      get.headers.get("content-type"),
    );
  });

  it("drains a streamed body instead of leaving the producer running", async () => {
    const alepha = Alepha.create();
    let cancelled = false;

    class TestApp {
      $route = $route({
        path: "/stream",
        handler: () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("chunk"));
            },
            cancel() {
              cancelled = true;
            },
          }) as never,
      });
    }

    await alepha.with(TestApp).start();
    const host = alepha.inject(ServerProvider).hostname;

    const head = await fetch(`${host}/stream`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    // A stream cannot report a length without being read, so GET would not
    // have sent one either - and the source has to be released rather than
    // drained into a buffer nobody reads.
    expect(head.headers.get("content-length")).toBe(null);
    expect(cancelled).toBe(true);
  });
});
