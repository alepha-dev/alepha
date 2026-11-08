import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger, MemoryDestinationProvider } from "alepha/logger";
import { describe, expect, it } from "vitest";

import { MemoryTraceProvider } from "../providers/MemoryTraceProvider.ts";
import { Span } from "../services/Span.ts";
import { Tracer } from "../services/Tracer.ts";

const create = () => {
  const alepha = Alepha.create();
  const tracer = alepha.inject(Tracer);
  const traces = alepha.inject(MemoryTraceProvider);
  return { alepha, tracer, traces };
};

describe("Tracer", () => {
  describe("with no sink", () => {
    it("calls fn directly with the shared no-op span", () => {
      const alepha = Alepha.create();
      const tracer = alepha.inject(Tracer);

      let seen: Span | undefined;
      const result = tracer.span("work", (span) => {
        seen = span;
        return 42;
      });

      expect(result).toBe(42);
      expect(seen).toBe(Span.noop);
      expect(tracer.recording).toBe(false);
      expect(tracer.current()).toBeUndefined();
    });

    it("keeps a continued trace's ids so they propagate, recording nothing", async () => {
      const alepha = Alepha.create();
      const tracer = alepha.inject(Tracer);
      const header = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

      const outgoing = await alepha.context.run(() =>
        tracer.startRoot("GET /", { traceparent: header }, async () =>
          tracer.span("inner", () => tracer.traceparent()),
        ),
      );

      expect(outgoing).toMatch(
        /^00-0af7651916cd43dd8448eb211c80319c-[0-9a-f]{16}-01$/,
      );
      expect(outgoing).not.toBe(header);
    });
  });

  describe("nesting", () => {
    it("makes a span opened inside another its child, and restores the parent after", async () => {
      const { alepha, tracer, traces } = create();

      await alepha.context.run(() =>
        tracer.startRoot("root", {}, async (root) => {
          await tracer.span("a", async () => {
            await tracer.span("a.1", async () => {});
          });
          expect(tracer.current()).toBe(root);
          tracer.span("b", () => {});
        }),
      );

      const root = traces.find("root")!;
      const a = traces.find("a")!;
      const a1 = traces.find("a.1")!;
      const b = traces.find("b")!;
      expect(root.parentSpanId).toBeUndefined();
      expect(a.parentSpanId).toBe(root.spanId);
      expect(a1.parentSpanId).toBe(a.spanId);
      expect(b.parentSpanId).toBe(root.spanId);
      expect(new Set([a.traceId, a1.traceId, b.traceId])).toEqual(
        new Set([root.traceId]),
      );
      expect(traces.traces()).toHaveLength(1);
      expect(traces.traces()[0]).toMatchObject({ name: "root", spanCount: 4 });
    });

    it("starts a new trace when a span opens outside any trace", () => {
      const { tracer, traces } = create();

      tracer.span("lonely", () => {});
      tracer.span("other", () => {});

      expect(traces.traces()).toHaveLength(2);
      expect(traces.find("lonely")!.parentSpanId).toBeUndefined();
    });

    it("keeps the parents of concurrent spans apart", async () => {
      const { alepha, tracer, traces } = create();
      const time = alepha.inject(DateTimeProvider);

      await alepha.context.run(() =>
        tracer.startRoot("root", {}, async () => {
          await Promise.all(
            ["x", "y"].map((name) =>
              tracer.span(name, async () => {
                await time.wait(5);
                await tracer.span(`${name}.child`, async () => {
                  await time.wait(1);
                });
              }),
            ),
          );
        }),
      );

      expect(traces.find("x.child")!.parentSpanId).toBe(
        traces.find("x")!.spanId,
      );
      expect(traces.find("y.child")!.parentSpanId).toBe(
        traces.find("y")!.spanId,
      );
    });
  });

  describe("sync and async", () => {
    it("returns a sync value and ends the span at once", () => {
      const { tracer, traces } = create();

      const value = tracer.span("sync", () => "done", { "app.kind": "sync" });

      expect(value).toBe("done");
      const span = traces.find("sync")!;
      expect(span.ended).toBe(true);
      expect(span.attributes).toEqual({ "app.kind": "sync" });
      expect(span.status).toBe("unset");
    });

    it("ends an async span when its promise settles", async () => {
      const { tracer, traces } = create();

      const value = await tracer.span("async", async () => "later");

      expect(value).toBe("later");
      expect(traces.find("async")!.ended).toBe(true);
    });
  });

  describe("errors", () => {
    it("records a sync throw and rethrows it unchanged", () => {
      const { tracer, traces } = create();
      const error = new TypeError("boom");

      expect(() =>
        tracer.span("bad", () => {
          throw error;
        }),
      ).toThrow(error);

      const span = traces.find("bad")!;
      expect(span.status).toBe("error");
      expect(span.exception).toEqual({ type: "TypeError", message: "boom" });
      expect(span.ended).toBe(true);
    });

    it("records a rejection and rethrows it", async () => {
      const { tracer, traces } = create();

      await expect(
        tracer.span("bad", async () => {
          throw new Error("nope");
        }),
      ).rejects.toThrow("nope");

      expect(traces.find("bad")!.status).toBe("error");
    });

    it("does not mark an abort as a failure", async () => {
      const { tracer, traces } = create();

      await expect(
        tracer.span("aborted", async () => {
          throw new DOMException("gone", "AbortError");
        }),
      ).rejects.toThrow("gone");

      const span = traces.find("aborted")!;
      expect(span.status).toBe("unset");
      expect(span.attributes["alepha.aborted"]).toBe(true);
    });
  });

  describe("time", () => {
    it("measures durations on the injectable clock, so travel() drives them", async () => {
      const { alepha, tracer, traces } = create();
      const time = alepha.inject(DateTimeProvider);
      time.pause();

      await tracer.span("slow", async () => {
        await time.travel([250, "milliseconds"]);
      });

      expect(traces.find("slow")!.duration).toBe(250);
    });
  });

  describe("manual end", () => {
    it("leaves a manualEnd span open until span.end()", async () => {
      const { alepha, tracer, traces } = create();

      const span = await alepha.context.run(() =>
        tracer.startRoot(
          "stream",
          { manualEnd: true, kind: "server" },
          async (s) => s,
        ),
      );

      expect(traces.find("stream")).toBeUndefined();
      span.end();
      span.end();
      expect(traces.spans()).toHaveLength(1);
      expect(traces.find("stream")!.kind).toBe("server");
    });
  });

  describe("traceparent", () => {
    it("continues an incoming trace as a child of the caller's span", async () => {
      const { alepha, tracer, traces } = create();

      alepha.context.run(() =>
        tracer.startRoot(
          "GET /",
          {
            traceparent:
              "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
          },
          () => {},
        ),
      );

      const root = traces.find("GET /")!;
      expect(root.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
      expect(root.parentSpanId).toBe("b7ad6b7169203331");
    });

    it("starts a new trace on an invalid header", async () => {
      const { alepha, tracer, traces } = create();

      alepha.context.run(() =>
        tracer.startRoot("GET /", { traceparent: "garbage" }, () => {}),
      );

      const root = traces.find("GET /")!;
      expect(root.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(root.parentSpanId).toBeUndefined();
    });

    it("records links to the producers' spans", async () => {
      const { alepha, tracer, traces } = create();

      alepha.context.run(() =>
        tracer.startRoot(
          "queue jobs",
          {
            kind: "consumer",
            linkTo: [
              "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
              undefined,
              "bad",
            ],
          },
          () => {},
        ),
      );

      const root = traces.find("queue jobs")!;
      expect(root.parentSpanId).toBeUndefined();
      expect(root.traceId).not.toBe("0af7651916cd43dd8448eb211c80319c");
      expect(root.links).toEqual([
        {
          traceId: "0af7651916cd43dd8448eb211c80319c",
          spanId: "b7ad6b7169203331",
        },
      ]);
    });
  });

  describe("sampling", () => {
    it("records nothing of an unsampled trace when no sink forces sampling", async () => {
      const alepha = Alepha.create({ env: { TRACING_SAMPLE_RATIO: 0 } });
      const tracer = alepha.inject(Tracer);
      const recorded: Span[] = [];
      tracer.addSink({ onEnd: (span) => recorded.push(span) });

      const outgoing = await alepha.context.run(() =>
        tracer.startRoot("GET /", {}, async () =>
          tracer.span("child", () => tracer.traceparent()),
        ),
      );

      expect(recorded).toHaveLength(0);
      expect(outgoing).toMatch(/-00$/);
    });

    it("honors an incoming unsampled flag", async () => {
      const alepha = Alepha.create();
      const tracer = alepha.inject(Tracer);
      const recorded: Span[] = [];
      tracer.addSink({ onEnd: (span) => recorded.push(span) });

      alepha.context.run(() =>
        tracer.startRoot(
          "GET /",
          {
            traceparent:
              "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00",
          },
          () => tracer.span("child", () => {}),
        ),
      );

      expect(recorded).toHaveLength(0);
    });

    it("forces a ratio of 1 while the memory sink is on", () => {
      const alepha = Alepha.create({ env: { TRACING_SAMPLE_RATIO: 0 } });
      const tracer = alepha.inject(Tracer);
      expect(tracer.sampleRatio).toBe(0);
      alepha.inject(MemoryTraceProvider);
      expect(tracer.sampleRatio).toBe(1);
    });
  });

  describe("memory ring", () => {
    it("keeps the last maxTraces traces, oldest dropped first", () => {
      const { tracer, traces } = create();
      traces.maxTraces = 3;

      for (const name of ["t1", "t2", "t3", "t4", "t5"]) {
        tracer.span(name, () => {});
      }

      expect(traces.traces().map((t) => t.name)).toEqual(["t5", "t4", "t3"]);
    });

    it("caps the spans of one trace", async () => {
      const { alepha, tracer, traces } = create();
      traces.maxSpansPerTrace = 2;

      alepha.context.run(() =>
        tracer.startRoot("root", {}, () => {
          for (let i = 0; i < 5; i++) {
            tracer.span(`s${i}`, () => {});
          }
        }),
      );

      expect(traces.spans()).toHaveLength(2);
    });
  });

  describe("logs", () => {
    it("stamps log entries with the active trace and span", async () => {
      const alepha = Alepha.create();
      const tracer = alepha.inject(Tracer);
      alepha.inject(MemoryTraceProvider);

      class Worker {
        log = $logger();
      }
      const worker = alepha.inject(Worker);
      const destination = alepha.inject(MemoryDestinationProvider);
      await alepha.start();

      worker.log.info("outside");
      let ids: { traceId: string; spanId: string } | undefined;
      alepha.context.run(() =>
        tracer.startRoot("root", {}, (span) => {
          ids = { traceId: span.traceId, spanId: span.spanId };
          worker.log.info("inside");
        }),
      );

      const outside = destination.logs.find((l) => l.message === "outside")!;
      const inside = destination.logs.find((l) => l.message === "inside")!;
      expect(outside.traceId).toBeUndefined();
      expect(inside).toMatchObject(ids!);
    });
  });
});
