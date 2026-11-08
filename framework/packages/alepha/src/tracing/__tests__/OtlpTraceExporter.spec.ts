import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { MemoryDestinationProvider } from "alepha/logger";
import { afterEach, describe, it } from "vitest";

import { OtlpTraceExporter } from "../providers/OtlpTraceExporter.ts";
import { Tracer } from "../services/Tracer.ts";

/**
 * The OTLP/HTTP JSON exporter (#E86), against a real HTTP receiver.
 */
describe("OtlpTraceExporter", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });
    server = undefined;
  });

  const receiver = async (status = 200) => {
    const posts: Array<{
      url: string;
      headers: IncomingMessage["headers"];
      body: any;
    }> = [];
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        posts.push({
          url: req.url ?? "",
          headers: req.headers,
          body: JSON.parse(raw),
        });
        res.statusCode = status;
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const port = (server!.address() as AddressInfo).port;
    return { posts, endpoint: `http://127.0.0.1:${port}/otlp/` };
  };

  const boot = async (env: Record<string, string>) => {
    const alepha = Alepha.create({ env: { APP_NAME: "billing", ...env } });
    const tracer = alepha.inject(Tracer);
    const exporter = alepha.inject(OtlpTraceExporter);
    await alepha.start();
    return { alepha, tracer, exporter };
  };

  it("stays off without OTEL_EXPORTER_OTLP_ENDPOINT", async ({ expect }) => {
    const { tracer } = await boot({});
    expect(tracer.recording).toBe(false);
  });

  it("posts OTLP JSON to <endpoint>/v1/traces with the configured headers, on stop", async ({
    expect,
  }) => {
    const { posts, endpoint } = await receiver();
    const { alepha, tracer } = await boot({
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      OTEL_EXPORTER_OTLP_HEADERS: "authorization=Basic%20abc==, x-team=ops",
    });
    expect(tracer.recording).toBe(true);

    expect(() =>
      alepha.context.run(() =>
        tracer.startRoot(
          "GET /orders/:id",
          {
            kind: "server",
            linkTo: ["00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"],
          },
          () =>
            tracer.span(
              "select orders",
              () => {
                throw new TypeError("bad row");
              },
              { "db.rows": 3, ratio: 0.5, cached: false, table: "orders" },
            ),
        ),
      ),
    ).toThrow("bad row");
    expect(posts).toHaveLength(0);

    await alepha.stop();

    expect(posts).toHaveLength(1);
    const [post] = posts;
    expect(post.url).toBe("/otlp/v1/traces");
    expect(post.headers["content-type"]).toBe("application/json");
    expect(post.headers.authorization).toBe("Basic abc==");
    expect(post.headers["x-team"]).toBe("ops");

    const [resource] = post.body.resourceSpans;
    expect(resource.resource.attributes).toContainEqual({
      key: "service.name",
      value: { stringValue: "billing" },
    });
    const spans = resource.scopeSpans[0].spans;
    expect(spans).toHaveLength(2);
    const [child, root] = spans;
    expect(root.name).toBe("GET /orders/:id");
    expect(root.kind).toBe(2);
    expect(root.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(root.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(root.parentSpanId).toBeUndefined();
    expect(root.links).toEqual([
      {
        traceId: "0af7651916cd43dd8448eb211c80319c",
        spanId: "b7ad6b7169203331",
      },
    ]);
    expect(root.startTimeUnixNano).toMatch(/^\d{19}$/);
    expect(BigInt(root.endTimeUnixNano)).toBeGreaterThanOrEqual(
      BigInt(root.startTimeUnixNano),
    );

    expect(child.kind).toBe(1);
    expect(child.parentSpanId).toBe(root.spanId);
    expect(child.status).toEqual({ code: 2, message: "bad row" });
    expect(child.attributes).toEqual([
      { key: "db.rows", value: { intValue: "3" } },
      { key: "ratio", value: { doubleValue: 0.5 } },
      { key: "cached", value: { boolValue: false } },
      { key: "table", value: { stringValue: "orders" } },
    ]);
    expect(child.events[0].name).toBe("exception");
    expect(child.events[0].attributes).toContainEqual({
      key: "exception.type",
      value: { stringValue: "TypeError" },
    });
  });

  it("sends a batch when it reaches maxBatchSize, and on the interval otherwise", async ({
    expect,
  }) => {
    // Batching is about when `send` is called, not about the network: the
    // wire format has its own spec above, against a real receiver.
    const sizes: number[] = [];
    class RecordingExporter extends OtlpTraceExporter {
      protected override async send(body: string): Promise<Response> {
        sizes.push(
          JSON.parse(body).resourceSpans[0].scopeSpans[0].spans.length,
        );
        return new Response("{}");
      }
    }
    const alepha = Alepha.create({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1" },
    }).with({ provide: OtlpTraceExporter, use: RecordingExporter });
    const tracer = alepha.inject(Tracer);
    const exporter = alepha.inject(OtlpTraceExporter);
    await alepha.start();
    const time = alepha.inject(DateTimeProvider);
    exporter.maxBatchSize = 3;

    for (let i = 0; i < 4; i++) {
      tracer.span(`s${i}`, () => {});
    }

    // The third span filled a batch, which left at once; the fourth waits.
    expect(sizes).toEqual([3]);

    await time.travel([5, "seconds"]);
    await expect.poll(() => sizes, { timeout: 5000 }).toEqual([3, 1]);
  });

  it("never exports an unsampled trace", async ({ expect }) => {
    const { posts, endpoint } = await receiver();
    const { alepha, tracer } = await boot({
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      TRACING_SAMPLE_RATIO: "0",
    });

    alepha.context.run(() =>
      tracer.startRoot("GET /", {}, () => tracer.span("child", () => {})),
    );
    alepha.context.run(() =>
      tracer.startRoot(
        "GET /continued",
        {
          traceparent:
            "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        },
        () => {},
      ),
    );
    await alepha.stop();

    const names = posts.flatMap((p) =>
      p.body.resourceSpans[0].scopeSpans[0].spans.map((s: any) => s.name),
    );
    // Ratio 0 refuses the new trace; a caller that sampled is honored.
    expect(names).toEqual(["GET /continued"]);
  });

  it("logs a failed export once, drops it, and never throws", async ({
    expect,
  }) => {
    const { posts, endpoint } = await receiver(503);
    const { alepha, tracer, exporter } = await boot({
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    });
    const logs = alepha.inject(MemoryDestinationProvider);

    tracer.span("a", () => {});
    await exporter.flush();
    tracer.span("b", () => {});
    await exporter.flush();

    expect(posts).toHaveLength(2);
    const warnings = logs.logs.filter((l) =>
      l.message.startsWith("OTLP export failed"),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].level).toBe("WARN");

    // An unreachable receiver is the same: one warning at most, no throw.
    server!.close();
    tracer.span("c", () => {});
    await expect(exporter.flush()).resolves.toBeUndefined();
    await alepha.stop();
  });
});
