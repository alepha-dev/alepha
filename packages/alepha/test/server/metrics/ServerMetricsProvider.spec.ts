import { Alepha } from "alepha";
import { ServerProvider } from "alepha/server";
import { AlephaServerMetrics } from "alepha/server/metrics";
import { describe, it } from "vitest";

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
});
