import { Alepha } from "alepha";
import { BackgroundTaskProvider } from "alepha/background";
import { RootComponentsProvider } from "alepha/react/router";
import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { SigilRoot } from "../browser/components/SigilRoot.tsx";
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
  it("mounts the feedback button in the host app's React tree", async () => {
    const alepha = make();
    // Resolved before boot: the container locks on `start()`, so asking for it
    // afterwards would be adding a service, not reading one.
    const roots = alepha.inject(RootComponentsProvider);
    await alepha.start();

    // Importing the module IS the integration: no second module to know about,
    // no JSX for the host to place. Note this host has no sink configured and
    // still gets the element — `<SigilRoot />` decides for itself, returning
    // `null` until the sink hands out a feedback URL.
    expect(roots.rootComponents).toHaveLength(1);
    const [mounted] = roots.rootComponents;
    expect(isValidElement(mounted)).toBe(true);
    expect((mounted as ReactElement).type).toBe(SigilRoot);
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
      SIGIL_CONFIG: '{"project":"demo","sink":"https://sigil.example.com"}',
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

describe("AlephaSigil — the flush survives the response", () => {
  /**
   * `SigilSinkProvider` defers its end-of-request flush, and on workerd only
   * `WorkerdBackgroundTaskProvider` keeps the isolate alive for it. Nothing
   * else in a docs-shaped app pulls `alepha/background` — `alepha/api/jobs`
   * does, and a static site has no jobs — so without the module's own import
   * the base provider is resolved, `keepAlive` is a no-op, and every beacon is
   * answered `{"ok":true}` while nothing is ever delivered.
   */
  it("registers the background provider it defers onto", async () => {
    const alepha = Alepha.create({
      env: {
        NODE_ENV: "production",
        APP_SECRET: "test-secret",
        SERVER_PORT: 0,
      },
    }).with(AlephaSigil);
    await alepha.start();

    expect(alepha.inject(BackgroundTaskProvider)).toBeDefined();
  });
});
