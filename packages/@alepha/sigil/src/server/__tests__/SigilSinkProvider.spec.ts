import { Alepha } from "alepha";
import { BackgroundTaskProvider } from "alepha/background";
import { HttpClient } from "alepha/server";
import { describe, expect, it } from "vitest";
import { AlephaSigil } from "../../index.ts";
import { sigilClientAtom } from "../../shared/sigilClientAtom.ts";
import { SigilSinkProvider } from "../SigilSinkProvider.ts";

/**
 * Records what the sink was asked, and answers whatever the test queued.
 *
 * Substituted through DI rather than mocked: the provider's whole job is
 * deciding *what* and *when* to send, and that is only observable from the
 * calls it makes.
 */
class RecordingHttpClient extends HttpClient {
  public calls: Array<{ url: string; body: any; headers: any }> = [];
  public configResponse: any = {};
  public failNext = false;

  async fetch(url: string, opts: any): Promise<any> {
    this.calls.push({ url, body: opts?.body, headers: opts?.headers });
    if (this.failNext) {
      this.failNext = false;
      throw new Error("sink unreachable");
    }
    if (url.endsWith("/sigils/config")) {
      return { data: this.configResponse, status: 200 } as any;
    }
    return { data: {}, status: 204 } as any;
  }
}

const make = (env: Record<string, any> = {}) =>
  Alepha.create({
    env: {
      NODE_ENV: "production",
      APP_SECRET: "test-secret",
      SERVER_PORT: 0,
      ...env,
    },
  }).with({ provide: HttpClient, use: RecordingHttpClient });

const withSink = (
  config: Record<string, any> = {},
  env: Record<string, any> = {},
) =>
  make({
    SIGIL_CONFIG: JSON.stringify({
      project: "demo",
      sink: "https://sigil.example.com/",
      ...config,
    }),
    SIGIL_KEY: "tk_secret",
    ...env,
  });

/**
 * Exposes the end-of-request decision.
 *
 * Calling the handler rather than emitting `server:onResponse`: the real event
 * wakes every other subscriber — the logger and the helmet provider both read
 * a full request/response pair — and none of that is what this tests.
 */
class TestSinkProvider extends SigilSinkProvider {
  public testOnResponse() {
    return (this.onResponse as any).options.handler({} as any);
  }
}

const ingests = (http: RecordingHttpClient) =>
  http.calls.filter((c) => c.url.endsWith("/sigils/ingest"));

const anError = (message: string, frame = "at f (app.js:1:1)") => ({
  name: "TypeError",
  message,
  stack: `TypeError: ${message}\n    ${frame}`,
  sourceUrl: "https://app/",
});

describe("SigilSinkProvider", () => {
  it("sends nothing at all without a sink", async () => {
    const alepha = make();
    const sink = alepha.inject(SigilSinkProvider);
    await alepha.start();

    await sink.ingest({ errors: [anError("boom")] });
    await sink.flush();

    expect(sink.hasSink()).toBe(false);
    expect(alepha.inject(HttpClient) as RecordingHttpClient).toHaveProperty(
      "calls",
      [],
    );
  });

  it("collapses a crash loop into one line with a count", async () => {
    const alepha = withSink();
    const sink = alepha.inject(SigilSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();

    // The same failure a thousand times is one fact, not a thousand.
    for (let i = 0; i < 50; i++) {
      await sink.ingest({ errors: [anError("boom")] });
    }
    await sink.flush();

    const sent = JSON.parse(ingests(http).at(-1)!.body);
    expect(sent.errors).toHaveLength(1);
    expect(sent.errors[0].count).toBe(50);
  });

  it("keeps the first sample, not the most recent one", async () => {
    const alepha = withSink();
    const sink = alepha.inject(SigilSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();

    // Same fingerprint (same name + frame), different message text.
    await sink.ingest({ errors: [anError("user 1 missing")] });
    await sink.ingest({ errors: [anError("user 2 missing")] });
    await sink.flush();

    const sent = JSON.parse(ingests(http).at(-1)!.body);
    expect(sent.errors[0].message).toBe("user 1 missing");
    expect(sent.errors[0].count).toBe(2);
  });

  it("keeps distinct throw sites apart", async () => {
    const alepha = withSink();
    const sink = alepha.inject(SigilSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();

    await sink.ingest({ errors: [anError("boom", "at render (a.js:1:1)")] });
    await sink.ingest({ errors: [anError("boom", "at save (b.js:2:2)")] });
    await sink.flush();

    expect(JSON.parse(ingests(http).at(-1)!.body).errors).toHaveLength(2);
  });

  it("presents the key as a bearer, and never in the body", async () => {
    const alepha = withSink();
    const sink = alepha.inject(SigilSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();

    await sink.ingest({ views: [{ path: "/" }] });
    await sink.flush();

    const call = ingests(http).at(-1)!;
    expect(call.headers.authorization).toBe("Bearer tk_secret");
    expect(call.body).not.toContain("tk_secret");
  });

  it("normalises a trailing slash on the sink origin", async () => {
    const alepha = withSink();
    const sink = alepha.inject(SigilSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();

    await sink.ingest({ views: [{ path: "/" }] });
    await sink.flush();

    expect(ingests(http).at(-1)!.url).toBe(
      "https://sigil.example.com/sigils/ingest",
    );
  });

  it("drops a tracker the config turned off, at the source", async () => {
    const alepha = withSink({ analytics: false });
    const sink = alepha.inject(SigilSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();

    await sink.ingest({ views: [{ path: "/" }], errors: [anError("boom")] });
    await sink.flush();

    // The point of a kill-switch is to stop the traffic, not to move where it
    // is discarded.
    const sent = JSON.parse(ingests(http).at(-1)!.body);
    expect(sent.views).toBeUndefined();
    expect(sent.errors).toHaveLength(1);
  });

  it("keeps collecting when the sink never answers", async () => {
    const alepha = withSink();
    const sink = alepha.inject(SigilSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();
    http.failNext = true;

    // A sink that is down must not silence an app's reporting.
    await sink.ingest({ errors: [anError("boom")] });
    await sink.flush();

    expect(sink.enabledTrackers().errors).toBe(true);
  });

  it("does not accumulate forever when flushes keep failing", async () => {
    const alepha = withSink();
    const sink = alepha.inject(SigilSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();

    await sink.ingest({ errors: [anError("boom")] });
    http.failNext = true;
    await sink.flush();

    // Losing a batch is a gap in a chart; holding every batch is an outage.
    const before = ingests(http).length;
    await sink.flush();
    expect(ingests(http).length).toBe(before);
  });

  it("has the feedback URL ready for the very first render", async () => {
    // The full module, so `sigilClientAtom` is registered and the render hook
    // writes somewhere real.
    const alepha = Alepha.create({
      env: {
        NODE_ENV: "production",
        APP_SECRET: "test-secret",
        SERVER_PORT: 0,
        SIGIL_CONFIG: '{"project":"demo","sink":"https://sigil.example.com/"}',
        SIGIL_KEY: "tk_secret",
      },
    })
      .with({ provide: HttpClient, use: RecordingHttpClient })
      .with(AlephaSigil);
    await alepha.start();

    // Nothing has been ingested — and `ingest()` used to be the only caller of
    // `refreshConfig()`. A cold isolate rendering its first page still has to
    // know where feedback goes, or the button is absent until some unrelated
    // traffic happens to warm the cache, which on a per-request runtime may
    // never be the same isolate. Derived from `project` now, so there is no
    // cache to be cold.
    await alepha.events.emit("react:server:render:begin", {
      state: {},
    } as any);

    const published = alepha.store.get(sigilClientAtom);
    expect(published.feedbackUrl).toBe(
      "https://sigil.example.com/demo/request",
    );
    // And stamped, so a page that outlives it can tell.
    expect(published.configAt).toBeGreaterThan(0);
  });

  /**
   * The config is read from `SIGIL_CONFIG`, so there is no GET to rate-limit
   * any more. This asserts the absence: a provider that asked the sink what to
   * collect could not cache the answer across a serverless isolate, and baked
   * it into the HTML on a prerendered app.
   */
  it("never asks the sink what to collect", async () => {
    const alepha = withSink();
    const sink = alepha.inject(SigilSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();

    await sink.ingest({ views: [{ path: "/", ts: 1 }] });
    await sink.flush();

    expect(http.calls.every((c) => c.url.endsWith("/sigils/ingest"))).toBe(
      true,
    );
  });

  it("flushes what it is holding when the app stops", async () => {
    const alepha = withSink();
    const sink = alepha.inject(SigilSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();

    // The batch a process holds when it stops describes why it stopped.
    await sink.ingest({ errors: [anError("last words")] });
    expect(ingests(http)).toHaveLength(0);

    await alepha.stop();

    expect(JSON.parse(ingests(http).at(-1)!.body).errors[0].message).toBe(
      "last words",
    );
  });
});

describe("SigilSinkProvider — surviving a runtime that does not", () => {
  /*
    The batch waits ten seconds or a cap, and the decision is taken inside
    `ingest()` — no timers, because a timer in a serverless isolate is a
    promise nobody kept.

    That works on a long-running server: the next request arrives and carries
    the decision forward. On Cloudflare Workers the isolate is torn down
    between requests, so a batch under the cap and younger than the window is
    not delayed, it is gone. Lore — the app this most affects — is exactly
    there.
  */

  it("should flush at the end of a request when the runtime is serverless", async () => {
    // `ALEPHA_SERVERLESS` is what `isServerless()` reads — set through env
    // rather than by overriding the method, so the test exercises the same
    // signal production does.
    const alepha = withSink({}, { ALEPHA_SERVERLESS: "true" });
    const sink = alepha.inject(TestSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();

    await sink.ingest({ views: [{ path: "/" }] });
    expect(ingests(http)).toHaveLength(0);

    await sink.testOnResponse();
    // The hook defers rather than awaits — the point of the change — so the
    // send is in flight, not done. `BackgroundTaskProvider.flush` is what
    // `stop` uses to drain them, and it is what makes this deterministic
    // instead of dependent on how many microtask ticks an await happens to
    // give it.
    await alepha.inject(BackgroundTaskProvider).flush();

    expect(ingests(http)).toHaveLength(1);
  });

  it("should keep batching on a long-running server", async () => {
    // The aggregation is the point: a failing endpoint produces thousands of
    // identical errors a minute, and one row per occurrence is what this
    // avoids. Flushing per request there would throw that away for nothing.
    const alepha = withSink();
    const sink = alepha.inject(TestSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();

    await sink.ingest({ views: [{ path: "/" }] });
    await sink.testOnResponse();

    expect(ingests(http)).toHaveLength(0);
  });

  it("should not send an empty batch on every response", async () => {
    // A request that produced nothing must not cost a round trip to the sink.
    const alepha = withSink({}, { ALEPHA_SERVERLESS: "true" });
    const sink = alepha.inject(TestSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();

    await sink.testOnResponse();

    expect(ingests(http)).toHaveLength(0);
  });
});

describe("SigilSinkProvider — half-configured", () => {
  /**
   * Inert, not fatal. Telemetry is never worth an outage: an app whose
   * observability is misconfigured should still serve its users, and a throw
   * would make rolling this variable out the riskiest kind of deploy — the app
   * that fails to boot being the one about to start reporting correctly.
   */
  it("stays inert and boots when the key is set without a config", async () => {
    const alepha = make({ SIGIL_KEY: "tk_secret" });
    const sink = alepha.inject(SigilSinkProvider);

    await expect(alepha.start()).resolves.toBeDefined();
    expect(sink.hasSink()).toBe(false);
  });

  it("stays inert and boots when the config is set without a key", async () => {
    const alepha = make({ SIGIL_CONFIG: '{"project":"demo"}' });
    const sink = alepha.inject(SigilSinkProvider);

    await expect(alepha.start()).resolves.toBeDefined();
    expect(sink.hasSink()).toBe(false);
  });

  it("captures locally rather than sending when inert", async () => {
    const alepha = make({ SIGIL_KEY: "tk_secret" });
    const sink = alepha.inject(SigilSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();

    await sink.ingest({ errors: [anError("boom")] });
    await sink.flush();

    expect(http.calls).toHaveLength(0);
  });
});
