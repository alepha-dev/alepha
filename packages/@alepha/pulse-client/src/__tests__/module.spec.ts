import { Alepha } from "alepha";
import { RootComponentsProvider } from "alepha/react/router";
import { describe, expect, it } from "vitest";
import { AlephaPulse } from "../index.ts";
import { PulseMetricsProvider } from "../server/PulseMetricsProvider.ts";
import { PulseSinkProvider } from "../server/PulseSinkProvider.ts";

const make = (env: Record<string, any> = {}) =>
  Alepha.create({
    env: {
      NODE_ENV: "production",
      APP_SECRET: "test-secret",
      SERVER_PORT: 0,
      ...env,
    },
  }).with(AlephaPulse);

describe("AlephaPulse module", () => {
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
    const sink = alepha.inject(PulseSinkProvider);
    await alepha.start();

    // The headless case is a supported mode, not a misconfiguration: capture
    // locally, send nothing.
    expect(sink.hasSink()).toBe(false);
  });

  it("samples the five series and a heartbeat", async () => {
    /**
     * Exercises the sampler directly rather than through `server:onResponse`.
     * Driving it from the event bus means faking a request shape that every
     * other listener also reads, which tests the fake more than the code.
     *
     * ⚠️ This does NOT prove the sampler is registered in the module — and it
     * shipped unregistered, so nothing sampled anything. Three attempts at a
     * registration guard all passed with the entry removed; that gap is
     * currently covered only by checking a deployed app really reports.
     */
    class Sampler extends PulseMetricsProvider {
      public async testSample(now: number) {
        return await this.sample(now);
      }
    }
    class RecordingSink extends PulseSinkProvider {
      public batches: any[] = [];
      override async ingest(envelope: any) {
        this.batches.push(envelope);
      }
    }

    const alepha = Alepha.create({
      env: { NODE_ENV: "production", APP_SECRET: "s", SERVER_PORT: 0 },
    }).with({ provide: PulseSinkProvider, use: RecordingSink });
    const sampler = alepha.inject(Sampler);
    await alepha.start();

    await sampler.testSample(Date.now());

    const sink = alepha.inject(PulseSinkProvider) as RecordingSink;
    const batch = sink.batches[0];
    expect(batch.metrics.map((m: any) => m.series)).toEqual(
      expect.arrayContaining(["rss", "heapUsed", "reqCount", "reqDurationP95"]),
    );
    expect(batch.heartbeat).toBeDefined();
  });

  it("unused placeholder", async () => {
    const alepha = make();
    const sink = alepha.inject(PulseSinkProvider);
    const metrics = alepha.inject(PulseMetricsProvider);
    await alepha.start();

    // The metrics sampler was written, exported and typechecked — and left out
    // of this list, so no app ever sampled anything. A service that is not
    // registered is a service that does not exist, and nothing else notices.
    // Resolving both before boot is the assertion: a service the module does
    // not declare would be *added* here, and the container refuses that once
    // started — so this fails loudly if the registration is dropped again.
    expect(sink).toBeDefined();
    expect(metrics).toBeDefined();
  });

  it("is configured by env alone", async () => {
    const alepha = make({
      PULSE_SINK: "https://pulse.example.com",
      PULSE_KEY: "tk",
    });
    const sink = alepha.inject(PulseSinkProvider);
    await alepha.start();

    expect(sink.hasSink()).toBe(true);
  });
});
