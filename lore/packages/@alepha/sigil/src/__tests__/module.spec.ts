import { Alepha } from "alepha";
import { RootComponentsProvider } from "alepha/react/router";
import { describe, expect, it } from "vitest";
import { AlephaSigil } from "../index.ts";
import { SigilSinkProvider } from "../server/SigilSinkProvider.ts";
import { sigilEnvelope } from "../shared/schemas/sigilEnvelope.ts";

const make = (env: Record<string, any> = {}) =>
  Alepha.create({
    env: {
      NODE_ENV: "production",
      APP_SECRET: "test-secret",
      SERVER_PORT: 0,
      ...env,
    },
  }).with(AlephaSigil);

describe("AlephaSigil module", () => {
  it("puts nothing in the host app's React tree", async () => {
    const alepha = make();
    // Resolved before boot: the container locks on `start()`, and this
    // provider is no longer one the module brings in — asking for it
    // afterwards would be adding a service, not reading one.
    const roots = alepha.inject(RootComponentsProvider);
    await alepha.start();

    // This package used to mount a floating button and a screenshot dialog into
    // every app that imported it. A telemetry package that injects DOM has to be
    // styled, translated and kept out of the app's own layout — for one link.
    expect(roots.rootComponents).toHaveLength(0);
  });

  it("starts without a sink rather than failing", async () => {
    const alepha = make();
    // Resolved before `start()`: the container locks on boot, and injecting
    // afterwards is what a real app would never do either.
    const sink = alepha.inject(SigilSinkProvider);
    await alepha.start();

    // The headless case is a supported mode, not a misconfiguration: capture
    // locally, send nothing.
    expect(sink.hasSink()).toBe(false);
  });

  it("is configured by env alone", async () => {
    const alepha = make({
      SIGIL_SINK: "https://sigil.example.com",
      SIGIL_KEY: "tk",
    });
    const sink = alepha.inject(SigilSinkProvider);
    await alepha.start();

    expect(sink.hasSink()).toBe(true);
  });
});

describe("sigil envelope scope", () => {
  it("rejects metrics and heartbeat keys", () => {
    const parsed = sigilEnvelope.safeParse({
      views: [{ path: "/" }],
      metrics: [{ series: "rss", value: 1, at: 0 }],
      heartbeat: { uptimeSec: 1 },
    });
    // Unknown keys are stripped, not carried
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("metrics");
    expect(parsed.data).not.toHaveProperty("heartbeat");
  });

  it("does not export a metrics provider", async () => {
    const mod = await import("../server/index.ts");
    expect(Object.keys(mod)).not.toContain("SigilMetricsProvider");
  });
});
