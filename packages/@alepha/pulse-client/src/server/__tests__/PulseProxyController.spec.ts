import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { PulseProxyController } from "../PulseProxyController.ts";
import { PulseSinkProvider } from "../PulseSinkProvider.ts";

/**
 * Captures what the controller hands on, so the stamping is observable without
 * a sink.
 */
class FakeSink extends PulseSinkProvider {
  public ingested: Array<{ env: any; stamp: any }> = [];

  override async ingest(env: any, stamp: any = {}) {
    this.ingested.push({ env, stamp });
  }
}

const make = () =>
  Alepha.create({
    env: {
      NODE_ENV: "production",
      APP_SECRET: "test-secret",
      SERVER_PORT: 0,
    },
  }).with({ provide: PulseSinkProvider, use: FakeSink });

describe("PulseProxyController.ingest", () => {
  it("stamps country + a stable visitor hash from the request edge and forwards", async () => {
    const alepha = make();
    const ctrl = alepha.inject(PulseProxyController);
    await alepha.start();

    await ctrl.ingest.run({
      body: { views: [{ path: "/" }] },
      headers: {
        "cf-ipcountry": "FR",
        "cf-connecting-ip": "1.2.3.4",
        "user-agent": "UA",
      },
    });

    const fwd = alepha.inject(PulseSinkProvider) as FakeSink;
    expect(fwd.ingested[0].stamp.country).toBe("FR");
    expect(typeof fwd.ingested[0].stamp.visitor).toBe("string");
    expect(fwd.ingested[0].stamp.visitor.length).toBeGreaterThan(0);
  });

  it("stable visitor hash: same edge inputs same day → same hash", async () => {
    const alepha = make();
    const ctrl = alepha.inject(PulseProxyController);
    await alepha.start();

    const headers = {
      "cf-ipcountry": "FR",
      "cf-connecting-ip": "1.2.3.4",
      "user-agent": "UA",
    };

    await ctrl.ingest.run({ body: { views: [] }, headers });
    await ctrl.ingest.run({ body: { views: [] }, headers });

    const fwd = alepha.inject(PulseSinkProvider) as FakeSink;
    expect(fwd.ingested[0].stamp.visitor).toBe(fwd.ingested[1].stamp.visitor);
  });

  it("accepts even when there is no sink configured", async () => {
    // The browser must not learn anything about the app's telemetry setup from
    // this endpoint, and a 200 costs nothing: whether the batch travels is the
    // sink provider's decision, made after this returns.
    const alepha = make();
    const ctrl = alepha.inject(PulseProxyController);
    await alepha.start();

    const result = await ctrl.ingest.run({
      body: { views: [{ path: "/" }] },
      headers: {},
    });

    expect(result.ok).toBe(true);
  });

  it("country is undefined when cf-ipcountry header is absent", async () => {
    const alepha = make();
    const ctrl = alepha.inject(PulseProxyController);
    await alepha.start();

    await ctrl.ingest.run({
      body: { views: [] },
      headers: { "cf-connecting-ip": "5.5.5.5", "user-agent": "bot" },
    });

    const fwd = alepha.inject(PulseSinkProvider) as FakeSink;
    expect(fwd.ingested[0].stamp.country).toBeUndefined();
  });

  it("hands the body on untouched, kill-switches being the sink's job", async () => {
    const alepha = make();
    const ctrl = alepha.inject(PulseProxyController);
    await alepha.start();

    await ctrl.ingest.run({
      body: {
        views: [{ path: "/" }],
        errors: [{ name: "E", message: "m", stack: "", sourceUrl: "" }],
        vitals: [{ path: "/", metric: "lcp", value: 1 }],
      },
      headers: {},
    });

    // Filtering here too would be a second copy of the fetched config to keep
    // in sync, and the two would disagree the day one of them was forgotten.
    const fwd = alepha.inject(PulseSinkProvider) as FakeSink;
    expect(fwd.ingested).toHaveLength(1);
    expect(fwd.ingested[0].env.views).toBeDefined();
    expect(fwd.ingested[0].env.errors).toBeDefined();
    expect(fwd.ingested[0].env.vitals).toBeDefined();
  });

  it("salts the visitor hash with the host, so one sink cannot join two apps", async () => {
    const alepha = make();
    const ctrl = alepha.inject(PulseProxyController);
    await alepha.start();

    const edge = { "cf-connecting-ip": "1.2.3.4", "user-agent": "UA" };
    await ctrl.ingest.run({
      body: { views: [] },
      headers: { ...edge, host: "a.example.com" },
    });
    await ctrl.ingest.run({
      body: { views: [] },
      headers: { ...edge, host: "b.example.com" },
    });

    const fwd = alepha.inject(PulseSinkProvider) as FakeSink;
    expect(fwd.ingested[0].stamp.visitor).not.toBe(
      fwd.ingested[1].stamp.visitor,
    );
  });
});
