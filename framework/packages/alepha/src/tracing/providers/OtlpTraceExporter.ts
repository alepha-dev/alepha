import {
  $env,
  $hook,
  $inject,
  Alepha,
  AlephaError,
  type Infer,
  z,
} from "alepha";
import { DateTimeProvider, type Timeout } from "alepha/datetime";
import { $logger } from "alepha/logger";

import type { SpanSink } from "../interfaces/SpanSink.ts";
import type { SpanAttributeValue, SpanKind } from "../interfaces/SpanTypes.ts";
import type { Span } from "../services/Span.ts";
import { Tracer } from "../services/Tracer.ts";

const envSchema = z.object({
  OTEL_EXPORTER_OTLP_ENDPOINT: z
    .text({
      secret: false,
      description:
        "Base URL of an OTLP/HTTP receiver (a collector, or a hosted backend such as Grafana Cloud, Honeycomb or Axiom). Spans are posted as JSON to <endpoint>/v1/traces. Unset: no export. Node and Bun only.",
    })
    .optional(),
  OTEL_EXPORTER_OTLP_HEADERS: z
    .text({
      description:
        "Headers sent with every export, as comma-separated key=value pairs with URL-encoded values, e.g. `authorization=Basic%20abc,x-team=ops`.",
    })
    .optional(),
});

declare module "alepha" {
  interface Env extends Partial<Infer<typeof envSchema>> {}
}

/**
 * Posts finished spans to an OTLP/HTTP receiver as JSON (`/v1/traces`).
 *
 * On only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, with the standard OTel
 * variable names, so a backend's own setup guide applies as written. Spans
 * are batched: a batch leaves when it reaches {@link maxBatchSize} (512) or
 * {@link flushIntervalMs} (5 s) after its first span, and whatever is queued
 * leaves on `stop`. The queue is bounded ({@link maxQueueSize}): past it, new
 * spans are dropped rather than held.
 *
 * Posted with the global `fetch`, never `HttpClient`: the server module
 * imports the tracer, and an exporter that went through `HttpClient` would
 * trace its own posts. A failed export logs once at warn and drops its
 * batch: it never retries, never blocks a request and never throws into app
 * code.
 *
 * Node and Bun only. On Cloudflare Workers spans go to Cloudflare's own
 * tracer, which exports them itself.
 */
export class OtlpTraceExporter implements SpanSink {
  protected readonly alepha = $inject(Alepha);
  protected readonly tracer = $inject(Tracer);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly env = $env(envSchema);
  protected readonly log = $logger();

  public maxBatchSize = 512;
  public maxQueueSize = 4096;
  public flushIntervalMs = 5000;

  protected queue: Span[] = [];
  protected timer?: Timeout;
  protected inflight = new Set<Promise<void>>();
  protected warned = false;
  protected dropped = 0;

  /**
   * Whether the exporter is configured to run.
   */
  public get enabled(): boolean {
    return !!this.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  }

  /**
   * Where batches are posted: `<OTEL_EXPORTER_OTLP_ENDPOINT>/v1/traces`.
   */
  public get url(): string {
    const base = String(this.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "");
    return `${base.replace(/\/+$/, "")}/v1/traces`;
  }

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      if (!this.enabled) {
        return;
      }
      this.tracer.addSink(this);
      this.log.debug("Exporting spans over OTLP/HTTP", { url: this.url });
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: async () => {
      if (!this.enabled) {
        return;
      }
      await this.flush();
      await Promise.allSettled(this.inflight);
      this.tracer.removeSink(this);
    },
  });

  public onEnd(span: Span): void {
    if (this.queue.length >= this.maxQueueSize) {
      this.dropped++;
      return;
    }
    this.queue.push(span);
    if (this.queue.length >= this.maxBatchSize) {
      void this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = this.dateTime.createTimeout(
        () => {
          this.timer = undefined;
          void this.flush();
        },
        this.flushIntervalMs,
        undefined,
        { unref: true },
      );
    }
  }

  /**
   * Send everything queued now, in batches of {@link maxBatchSize}.
   * Resolves once every batch has been answered or has failed; never
   * rejects.
   */
  public async flush(): Promise<void> {
    if (this.timer) {
      this.dateTime.clearTimeout(this.timer);
      this.timer = undefined;
    }
    const sends: Promise<void>[] = [];
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.maxBatchSize);
      const sending = this.export(batch).finally(() => {
        this.inflight.delete(sending);
      });
      this.inflight.add(sending);
      sends.push(sending);
    }
    await Promise.allSettled(sends);
  }

  /**
   * Post one batch. Logs once at warn on failure (until an export succeeds
   * again) and drops the batch.
   */
  protected async export(batch: Span[]): Promise<void> {
    try {
      const response = await this.send(JSON.stringify(this.encode(batch)));
      if (!response.ok) {
        throw new AlephaError(`HTTP ${response.status}`);
      }
      this.warned = false;
    } catch (error) {
      if (!this.warned) {
        this.warned = true;
        this.log.warn(
          "OTLP export failed; dropping the batch. Further failures are silent until an export succeeds.",
          {
            url: this.url,
            spans: batch.length,
            message: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
  }

  /**
   * The HTTP post itself, on the global `fetch`.
   */
  protected send(body: string): Promise<Response> {
    return globalThis.fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.headers() },
      body,
      // Detached from any request: an export must never be cancelled by a
      // client that left.
      signal: AbortSignal.timeout(10_000),
    });
  }

  /**
   * `OTEL_EXPORTER_OTLP_HEADERS`, parsed: `k=v` pairs, comma-separated,
   * values URL-decoded.
   */
  public headers(): Record<string, string> {
    const raw = String(this.env.OTEL_EXPORTER_OTLP_HEADERS ?? "");
    const out: Record<string, string> = {};
    for (const pair of raw.split(",")) {
      const index = pair.indexOf("=");
      if (index <= 0) {
        continue;
      }
      const key = pair.slice(0, index).trim().toLowerCase();
      const value = pair.slice(index + 1).trim();
      try {
        out[key] = decodeURIComponent(value);
      } catch {
        out[key] = value;
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // OTLP/JSON encoding
  // -------------------------------------------------------------------------------------------------------------------

  /**
   * The `ExportTraceServiceRequest` for a batch, in OTLP's JSON mapping:
   * hex ids, int64 nanosecond timestamps as decimal strings, integer enums.
   */
  public encode(batch: Span[]): Record<string, unknown> {
    return {
      resourceSpans: [
        {
          resource: {
            attributes: this.attributes({
              "service.name": this.alepha.name,
              "service.version": this.alepha.meta.version,
              "telemetry.sdk.name": "alepha",
              "telemetry.sdk.language": "nodejs",
            }),
          },
          scopeSpans: [
            {
              scope: { name: "alepha" },
              spans: batch.map((span) => this.encodeSpan(span)),
            },
          ],
        },
      ],
    };
  }

  protected encodeSpan(span: Span): Record<string, unknown> {
    const end = span.endTime ?? span.startTime;
    const out: Record<string, unknown> = {
      traceId: span.traceId,
      spanId: span.spanId,
      name: span.name,
      kind: this.kind(span.kind),
      startTimeUnixNano: this.nanos(span.startTime),
      endTimeUnixNano: this.nanos(end),
      attributes: this.attributes(span.attributes),
      status: {
        code: span.status === "error" ? 2 : span.status === "ok" ? 1 : 0,
        ...(span.statusMessage ? { message: span.statusMessage } : {}),
      },
    };
    if (span.parentSpanId) {
      out.parentSpanId = span.parentSpanId;
    }
    if (span.links.length > 0) {
      out.links = span.links.map((link) => ({
        traceId: link.traceId,
        spanId: link.spanId,
      }));
    }
    if (span.exception) {
      out.events = [
        {
          name: "exception",
          timeUnixNano: this.nanos(end),
          attributes: this.attributes({
            "exception.type": span.exception.type,
            "exception.message": span.exception.message,
          }),
        },
      ];
    }
    return out;
  }

  /**
   * OTLP's `SpanKind` enum: 1 internal, 2 server, 3 client, 4 producer,
   * 5 consumer.
   */
  protected kind(kind: SpanKind): number {
    switch (kind) {
      case "server":
        return 2;
      case "client":
        return 3;
      case "producer":
        return 4;
      case "consumer":
        return 5;
      default:
        return 1;
    }
  }

  /**
   * Milliseconds since the epoch as int64 nanoseconds, in a decimal string.
   */
  protected nanos(ms: number): string {
    return (BigInt(Math.round(ms * 1000)) * 1000n).toString();
  }

  protected attributes(
    attributes: Record<string, SpanAttributeValue | undefined>,
  ): Array<{ key: string; value: Record<string, unknown> }> {
    const out: Array<{ key: string; value: Record<string, unknown> }> = [];
    for (const key in attributes) {
      const value = attributes[key];
      if (value === undefined) {
        continue;
      }
      if (typeof value === "boolean") {
        out.push({ key, value: { boolValue: value } });
      } else if (typeof value === "number") {
        out.push({
          key,
          value: Number.isInteger(value)
            ? { intValue: String(value) }
            : { doubleValue: value },
        });
      } else {
        out.push({ key, value: { stringValue: String(value) } });
      }
    }
    return out;
  }
}
