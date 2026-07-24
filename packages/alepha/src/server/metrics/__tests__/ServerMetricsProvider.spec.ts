import { Alepha } from "alepha";
import { ServerProvider } from "alepha/server";
import { describe, it } from "vitest";
import { AlephaServerMetrics } from "../index.ts";

describe("ServerMetricsProvider", () => {
  it("should expose metrics endpoint with process metrics", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaServerMetrics);
    await alepha.start();

    const resp = await fetch(
      `${alepha.inject(ServerProvider).hostname}/metrics`,
    );

    expect(resp.status).toBe(200);
    const text = await resp.text();

    expect(text).toContain("process_cpu_system_seconds_total");
    expect(text).toContain("process_cpu_seconds_total");
    expect(text).toContain("process_start_time_seconds");
    // etc...
  });

  it("should require the bearer token when METRICS_TOKEN is set", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { METRICS_TOKEN: "s3cret-metrics" },
    }).with(AlephaServerMetrics);
    await alepha.start();

    const hostname = alepha.inject(ServerProvider).hostname;

    const anonymous = await fetch(`${hostname}/metrics`);
    expect(anonymous.status).toBe(401);

    const wrong = await fetch(`${hostname}/metrics`, {
      headers: { authorization: "Bearer nope" },
    });
    expect(wrong.status).toBe(401);

    const ok = await fetch(`${hostname}/metrics`, {
      headers: { authorization: "Bearer s3cret-metrics" },
    });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("process_cpu_seconds_total");
  });
});
