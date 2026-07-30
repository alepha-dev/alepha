import { Alepha } from "alepha";
import { RootComponentsProvider } from "alepha/react/router";
import { describe, expect, it } from "vitest";
import { AlephaTelemetry } from "../index.ts";
import { TelemetrySinkProvider } from "../server/TelemetrySinkProvider.ts";

const make = (env: Record<string, any> = {}) =>
  Alepha.create({
    env: {
      NODE_ENV: "production",
      APP_SECRET: "test-secret",
      SERVER_PORT: 0,
      ...env,
    },
  }).with(AlephaTelemetry);

describe("AlephaTelemetry module", () => {
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
    const sink = alepha.inject(TelemetrySinkProvider);
    await alepha.start();

    // The headless case is a supported mode, not a misconfiguration: capture
    // locally, send nothing.
    expect(sink.hasSink()).toBe(false);
  });

  it("is configured by env alone", async () => {
    const alepha = make({
      TELEMETRY_SINK: "https://pulse.example.com",
      TELEMETRY_KEY: "tk",
    });
    const sink = alepha.inject(TelemetrySinkProvider);
    await alepha.start();

    expect(sink.hasSink()).toBe(true);
  });
});
