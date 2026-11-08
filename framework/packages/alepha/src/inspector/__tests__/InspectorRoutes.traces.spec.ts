import { Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { Tracer } from "alepha/tracing";
import { describe, it } from "vitest";

import { AlephaInspector } from "../index.ts";
import { InspectorDispatcher } from "../services/InspectorDispatcher.ts";

/**
 * `GET /traces` and `GET /traces/:id` (#E86): what devtools draws its
 * waterfall from. The inspector turns tracing on, so a dev run always has
 * traces to show.
 */
describe("InspectorRoutes: traces", () => {
  const call = async (alepha: Alepha, path: string) => {
    const res = await alepha
      .inject(InspectorDispatcher)
      .dispatch({ method: "GET", path });
    return { status: res.status, body: JSON.parse(JSON.stringify(res.body)) };
  };

  const boot = async () => {
    const alepha = Alepha.create({ env: { ALEPHA_INSPECT: "1" } }).with(
      AlephaInspector,
    );
    class Worker {
      log = $logger();
    }
    const worker = alepha.inject(Worker);
    await alepha.start();
    return { alepha, tracer: alepha.inject(Tracer), worker };
  };

  it("turns tracing on and lists recent traces, newest first", async ({
    expect,
  }) => {
    const { alepha, tracer } = await boot();
    expect(tracer.recording).toBe(true);

    alepha.context.run(() => tracer.startRoot("GET /first", {}, () => {}));
    alepha.context.run(() =>
      tracer.startRoot("GET /second", {}, (span) => {
        span.setStatus("error");
      }),
    );

    const res = await call(alepha, "/traces");
    expect(res.status).toBe(200);
    expect(
      res.body.traces.map((t: any) => [t.name, t.status, t.spanCount]),
    ).toEqual([
      ["GET /second", "error", 1],
      ["GET /first", "unset", 1],
    ]);
    await alepha.stop();
  });

  it("serves one trace with its spans, its log lines and the N+1 flag", async ({
    expect,
  }) => {
    const { alepha, tracer, worker } = await boot();

    let traceId = "";
    await alepha.context.run(() =>
      tracer.startRoot("GET /orders", {}, async (root) => {
        traceId = root.traceId;
        await tracer.span("action listOrders", async () => {
          worker.log.info("listing orders");
          for (let i = 0; i < 5; i++) {
            await tracer.span("select order_items", async () => {});
          }
          await tracer.span("select orders", async () => {});
        });
      }),
    );

    const res = await call(alepha, `/traces/${traceId}`);
    expect(res.status).toBe(200);
    expect(res.body.traceId).toBe(traceId);
    expect(res.body.spans).toHaveLength(8);

    const action = res.body.spans.find(
      (s: any) => s.name === "action listOrders",
    );
    expect(action.nPlusOne).toEqual({ name: "select order_items", count: 5 });
    const root = res.body.spans.find((s: any) => s.name === "GET /orders");
    expect(root.nPlusOne).toBeUndefined();

    const line = res.body.logs.find((l: any) => l.message === "listing orders");
    expect(line.spanId).toBe(action.spanId);
    await alepha.stop();
  });

  it("answers an unknown trace with no spans", async ({ expect }) => {
    const { alepha } = await boot();
    const res = await call(alepha, "/traces/0af7651916cd43dd8448eb211c80319c");
    expect(res.status).toBe(200);
    expect(res.body.spans).toEqual([]);
    await alepha.stop();
  });
});
