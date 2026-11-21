import { Alepha } from "alepha";
import { $route, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { AlephaServerMetrics, ServerMetricsProvider } from "../index.ts";

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
  });

  it("should time every request by method, route path and status", async ({
    expect,
  }) => {
    class App {
      user = $route({
        method: "GET",
        path: "/users/:id",
        handler: ({ params }) => `user ${params.id}`,
      });
    }
    const alepha = Alepha.create().with(AlephaServerMetrics).with(App);
    await alepha.start();
    const hostname = alepha.inject(ServerProvider).hostname;

    await (await fetch(`${hostname}/users/1`)).text();
    await (await fetch(`${hostname}/users/2`)).text();
    const text = await (await fetch(`${hostname}/metrics`)).text();

    // Labelled with the route's path, not the URL: one series per route.
    expect(text).toMatch(
      /^http_request_duration_seconds_count\{[^}]*path="\/users\/:id"[^}]*\} 2$/m,
    );
    const series = text
      .split("\n")
      .find((line) =>
        /^http_request_duration_seconds_count\{.*users/.test(line),
      );
    expect(series).toContain('method="GET"');
    expect(series).toContain('code="200"');
    expect(text).not.toContain('path="/users/1"');
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

describe("ServerMetricsProvider exposure warning", () => {
  /**
   * A test subclass, because the decision is what matters (whether the warning
   * fires), and asserting on log output would tie the test to its wording.
   */
  class TestMetricsProvider extends ServerMetricsProvider {
    public testIsLoopbackOnly = () => this.isLoopbackOnly();
  }

  const loopbackFor = (host?: string) =>
    Alepha.create({ env: host === undefined ? {} : { SERVER_HOST: host } })
      .inject(TestMetricsProvider)
      .testIsLoopbackOnly();

  it("should treat the server's default bind as not reachable", ({
    expect,
  }) => {
    // SERVER_HOST unset: the server binds its own default, localhost, and the
    // default is the server's to know, not the raw environment's.
    expect(loopbackFor()).toBe(true);
  });

  it("should treat a loopback bind as not reachable", ({ expect }) => {
    // The normal shape behind a reverse proxy: the proxy decides what the
    // internet sees, and a self-hosted supervisor typically refuses /metrics on
    // the public host outright. Warning here fires on every boot of every
    // correctly-configured app, which is how people learn to skip warnings.
    for (const host of ["localhost", "127.0.0.1", "::1", "[::1]"]) {
      expect(loopbackFor(host)).toBe(true);
    }
  });

  it("should treat a bind on all interfaces as reachable", ({ expect }) => {
    // The one case the warning is genuinely for.
    for (const host of ["0.0.0.0", "::", "10.0.0.4"]) {
      expect(loopbackFor(host)).toBe(false);
    }
  });
});
