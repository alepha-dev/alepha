import { $inject, Alepha, z } from "alepha";
import { MemoryTraceProvider, type Span } from "alepha/tracing";
import { describe, it } from "vitest";

import {
  $action,
  $route,
  AlephaServer,
  HttpClient,
  HttpError,
  ServerProvider,
} from "../index.ts";

/**
 * Request roots, action children and HttpClient client spans (#E86).
 */
const boot = async <T extends object>(App: new () => T) => {
  const alepha = Alepha.create().with(App).with(AlephaServer);
  const traces = alepha.inject(MemoryTraceProvider);
  await alepha.start();
  const host = alepha.inject(ServerProvider).hostname;
  return { alepha, traces, host, app: alepha.inject(App) };
};

const allAttributeValues = (spans: Span[]) =>
  spans.flatMap((span) => Object.values(span.attributes).map(String));

describe("server tracing", () => {
  it("opens one root per request, named by the route pattern, with an action child", async ({
    expect,
  }) => {
    class App {
      getUser = $action({
        method: "GET",
        path: "/users/:id",
        schema: {
          params: z.object({ id: z.text() }),
          response: z.object({ id: z.text() }),
        },
        handler: ({ params }) => ({ id: params.id }),
      });
    }
    const { traces, host } = await boot(App);

    const res = await fetch(`${host}/api/users/secret-42?token=abc`);
    expect(res.status).toBe(200);
    await res.text();

    const root = traces.find("GET /api/users/:id")!;
    expect(root).toBeDefined();
    expect(root.kind).toBe("server");
    expect(root.parentSpanId).toBeUndefined();
    expect(root.attributes).toMatchObject({
      "http.request.method": "GET",
      "http.route": "/api/users/:id",
      "http.response.status_code": 200,
      "url.scheme": "http",
    });
    expect(root.status).toBe("unset");

    const children = traces.children(root);
    expect(children.map((s) => s.name)).toEqual(["action getUser"]);

    // Never the raw URL, the query string or a header.
    const values = allAttributeValues(traces.trace(root.traceId)).join(" ");
    expect(values).not.toContain("secret-42");
    expect(values).not.toContain("abc");
  });

  it("marks a 5xx failed and leaves a 4xx unset", async ({ expect }) => {
    class App {
      boom = $action({
        method: "GET",
        path: "/boom",
        handler: () => {
          throw new Error("kaput");
        },
      });
      refuse = $action({
        method: "GET",
        path: "/refuse",
        handler: () => {
          throw new HttpError({ status: 404 }, { message: "nope" });
        },
      });
    }
    const { traces, host } = await boot(App);

    await (await fetch(`${host}/api/boom`)).text();
    await (await fetch(`${host}/api/refuse`)).text();

    const boom = traces.find("GET /api/boom")!;
    expect(boom.attributes["http.response.status_code"]).toBe(500);
    expect(boom.status).toBe("error");
    expect(traces.children(boom)[0].status).toBe("error");

    const refuse = traces.find("GET /api/refuse")!;
    expect(refuse.attributes["http.response.status_code"]).toBe(404);
    expect(refuse.status).toBe("unset");
  });

  it("continues an incoming traceparent, and starts a new trace on an invalid one", async ({
    expect,
  }) => {
    class App {
      hello = $route({ path: "/hello", handler: () => "hi" });
    }
    const { traces, host } = await boot(App);

    await (
      await fetch(`${host}/hello`, {
        headers: {
          traceparent:
            "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        },
      })
    ).text();
    await (
      await fetch(`${host}/hello`, { headers: { traceparent: "nonsense" } })
    ).text();

    const [continued, fresh] = traces
      .spans()
      .filter((s) => s.name === "GET /hello");
    expect(continued.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(continued.parentSpanId).toBe("b7ad6b7169203331");
    expect(fresh.traceId).not.toBe("0af7651916cd43dd8448eb211c80319c");
    expect(fresh.parentSpanId).toBeUndefined();
  });

  it("ends the root after a streamed body has been sent, not when the handler returns", async ({
    expect,
  }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    class App {
      stream = $route({
        path: "/stream",
        handler: ({ reply }) => {
          const encoder = new TextEncoder();
          reply.setHeader("content-type", "text/plain");
          reply.body = new ReadableStream({
            async start(controller) {
              controller.enqueue(encoder.encode("first "));
              await gate;
              controller.enqueue(encoder.encode("last"));
              controller.close();
            },
          });
        },
      });
    }
    const { traces, host } = await boot(App);

    const res = await fetch(`${host}/stream`);
    expect(res.status).toBe(200);
    expect(traces.find("GET /stream")).toBeUndefined();

    release();
    expect(await res.text()).toBe("first last");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(traces.find("GET /stream")?.ended).toBe(true);
  });

  it("forms one trace across two apps: client span, traceparent, server root", async ({
    expect,
  }) => {
    class Downstream {
      pong = $action({
        method: "GET",
        path: "/pong",
        schema: { response: z.object({ ok: z.boolean() }) },
        handler: () => ({ ok: true }),
      });
    }
    const downstream = await boot(Downstream);

    class Upstream {
      http = $inject(HttpClient);
      ping = $action({
        method: "GET",
        path: "/ping",
        schema: { response: z.object({ ok: z.boolean() }) },
        handler: async () => {
          const res = await this.http.fetch(`${downstream.host}/api/pong`);
          return res.data as { ok: boolean };
        },
      });
    }
    const upstream = await boot(Upstream);

    const res = await fetch(`${upstream.host}/api/ping`);
    expect(await res.json()).toEqual({ ok: true });

    const upRoot = upstream.traces.find("GET /api/ping")!;
    const action = upstream.traces.find("action ping")!;
    const client = upstream.traces.spans().find((s) => s.kind === "client")!;
    expect(action.parentSpanId).toBe(upRoot.spanId);
    expect(client.parentSpanId).toBe(action.spanId);
    expect(client.name).toBe(`GET ${new URL(downstream.host).host}`);
    expect(client.attributes).toMatchObject({
      "http.request.method": "GET",
      "server.address": new URL(downstream.host).host,
      "http.response.status_code": 200,
    });

    const downRoot = downstream.traces.find("GET /api/pong")!;
    expect(downRoot.traceId).toBe(upRoot.traceId);
    expect(downRoot.parentSpanId).toBe(client.spanId);
  });
});
