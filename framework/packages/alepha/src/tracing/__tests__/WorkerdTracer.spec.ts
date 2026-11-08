import { AsyncLocalStorage } from "node:async_hooks";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { Alepha } from "alepha";
import { $logger, MemoryDestinationProvider } from "alepha/logger";
import { HttpClient } from "alepha/server";
import { afterEach, describe, it } from "vitest";

import { Tracer } from "../services/Tracer.ts";
import {
  type CloudflareSpan,
  type CloudflareTracing,
  WorkerdTracer,
} from "../services/WorkerdTracer.ts";

/**
 * A stand-in for `cloudflare:workers`' `tracing`, nesting by async context
 * the way the platform does. `traced: false` answers all-zero ids, which is
 * what a Worker with traces off sees.
 */
class FakeSpan implements CloudflareSpan {
  public attributes: Record<string, unknown> = {};
  public exceptions: Array<{ name: string; message?: string }> = [];
  public status?: { code: string; message?: string };
  public ended = 0;
  public children: FakeSpan[] = [];
  public name: string;
  public readonly ids: { traceId: string; spanId: string };
  public readonly isTraced: boolean;
  constructor(
    name: string,
    ids: { traceId: string; spanId: string },
    isTraced = true,
  ) {
    this.name = name;
    this.ids = ids;
    this.isTraced = isTraced;
  }
  spanContext() {
    return { ...this.ids, traceFlags: 1 };
  }
  setAttributes(attributes: Record<string, unknown>) {
    Object.assign(this.attributes, attributes);
    return this;
  }
  recordException(exception: { name: string; message?: string }) {
    this.exceptions.push(exception);
  }
  updateName(name: string) {
    this.name = name;
    return this;
  }
  setStatus(status: { code: string; message?: string }) {
    this.status = status;
    return this;
  }
  end() {
    this.ended++;
  }
}

class FakeTracing implements CloudflareTracing {
  protected readonly als = new AsyncLocalStorage<FakeSpan>();
  protected n = 0;
  public readonly invocation: FakeSpan;
  protected readonly traced: boolean;
  constructor(invocation: FakeSpan, traced = true) {
    this.invocation = invocation;
    this.traced = traced;
  }
  protected id(width: number): string {
    if (!this.traced) return "0".repeat(width);
    this.n++;
    return this.n.toString(16).padStart(width, "a");
  }
  startActiveSpan<T>(name: string, callback: (span: FakeSpan) => T): T {
    const parent = this.getActiveSpan();
    const span = new FakeSpan(
      name,
      {
        traceId: this.invocation.ids.traceId,
        spanId: this.id(16),
      },
      this.traced,
    );
    parent.children.push(span);
    return this.als.run(span, () => callback(span));
  }
  getActiveSpan(): FakeSpan {
    return this.als.getStore() ?? this.invocation;
  }
}

const TRACE = "c0ffee00c0ffee00c0ffee00c0ffee00";

const boot = (traced = true) => {
  const invocation = new FakeSpan(
    "fetch",
    traced
      ? { traceId: TRACE, spanId: "1111111111111111" }
      : { traceId: "0".repeat(32), spanId: "0".repeat(16) },
    traced,
  );
  const platform = new FakeTracing(invocation, traced);
  class TestWorkerdTracer extends WorkerdTracer {
    protected override platform() {
      return platform;
    }
  }
  const alepha = Alepha.create().with({
    provide: Tracer,
    use: TestWorkerdTracer,
  });
  const tracer = alepha.inject(Tracer);
  return { alepha, tracer, invocation };
};

describe("WorkerdTracer", () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it("renames the invocation's span for the root and nests children as Cloudflare spans", async ({
    expect,
  }) => {
    const { alepha, tracer, invocation } = boot();

    await alepha.context.run(() =>
      tracer.startRoot(
        "GET /users/:id",
        { kind: "server", attributes: { "http.route": "/users/:id" } },
        async (root) => {
          root.setAttribute("http.response.status_code", 200);
          await tracer.span("action getUser", async () => {
            await tracer.span("select users", async () => {});
          });
        },
      ),
    );

    // No second root: the invocation's span carries the route's name.
    expect(invocation.name).toBe("GET /users/:id");
    expect(invocation.ended).toBe(0);
    expect(invocation.attributes).toMatchObject({
      "http.route": "/users/:id",
      "http.response.status_code": 200,
      "span.kind": "server",
    });

    const [action] = invocation.children;
    expect(action.name).toBe("action getUser");
    expect(action.ended).toBe(1);
    expect(action.children.map((s) => s.name)).toEqual(["select users"]);
  });

  it("uses Cloudflare's ids, so log lines carry what the dashboard shows", async ({
    expect,
  }) => {
    const { alepha, tracer, invocation } = boot();
    class Worker {
      log = $logger();
    }
    const worker = alepha.inject(Worker);
    const logs = alepha.inject(MemoryDestinationProvider);
    await alepha.start();

    await alepha.context.run(() =>
      tracer.startRoot("GET /", {}, async () => {
        worker.log.info("in root");
        await tracer.span("child", async () => {
          worker.log.info("in child");
        });
      }),
    );

    const inRoot = logs.logs.find((l) => l.message === "in root")!;
    const inChild = logs.logs.find((l) => l.message === "in child")!;
    expect(inRoot).toMatchObject({
      traceId: TRACE,
      spanId: "1111111111111111",
    });
    expect(inChild.traceId).toBe(TRACE);
    expect(inChild.spanId).toBe(invocation.children[0].ids.spanId);
  });

  it("records an exception and a 5xx status on the Cloudflare span", async ({
    expect,
  }) => {
    const { alepha, tracer, invocation } = boot();

    await alepha.context.run(() =>
      tracer.startRoot("POST /pay", {}, async (root) => {
        await tracer
          .span("action pay", async () => {
            throw new TypeError("card declined");
          })
          .catch(() => undefined);
        root.setAttribute("http.response.status_code", 500);
        root.setStatus("error");
      }),
    );

    const [action] = invocation.children;
    expect(action.exceptions).toEqual([
      { name: "TypeError", message: "card declined" },
    ]);
    expect(action.status).toEqual({ code: "error", message: "card declined" });
    expect(invocation.status?.code).toBe("error");
  });

  it("records nothing and stamps no log line when the Worker's traces are off", async ({
    expect,
  }) => {
    const { alepha, tracer, invocation } = boot(false);
    class Worker {
      log = $logger();
    }
    const worker = alepha.inject(Worker);
    const logs = alepha.inject(MemoryDestinationProvider);
    await alepha.start();

    expect(tracer.recording).toBe(false);
    await alepha.context.run(() =>
      tracer.startRoot("GET /", {}, () =>
        tracer.span("child", async () => {
          worker.log.info("untraced");
        }),
      ),
    );

    expect(invocation.children).toEqual([]);
    expect(invocation.name).toBe("fetch");
    expect(logs.logs.find((l) => l.message === "untraced")?.traceId).toBe(
      undefined,
    );
  });

  it("sends no traceparent from HttpClient", async ({ expect }) => {
    const seen: IncomingHttpHeaders[] = [];
    server = createServer((req, res) => {
      seen.push(req.headers);
      res.end("ok");
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

    const { alepha, tracer, invocation } = boot();
    const http = alepha.inject(HttpClient);
    await alepha.start();

    await alepha.context.run(() =>
      tracer.startRoot("GET /", {}, () => http.fetch(url)),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0].traceparent).toBeUndefined();
    // The call is still a span of the trace, on Cloudflare's side.
    expect(invocation.children.map((s) => s.name)).toContain(
      `GET 127.0.0.1:${(server.address() as AddressInfo).port}`,
    );
  });
});
