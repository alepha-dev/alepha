import { Alepha } from "alepha";
import { BackgroundTaskProvider } from "alepha/background";
import { HttpClient } from "alepha/server";
import { describe, expect, it } from "vitest";

import { AlephaSigil } from "../../index.ts";
import { sigilClientAtom } from "../../shared/sigilClientAtom.ts";
import { SIGIL_DEFAULT_SINK } from "../../sigilEnv.ts";
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
  public failNext = false;

  async fetch(url: string, opts: any): Promise<any> {
    this.calls.push({ url, body: opts?.body, headers: opts?.headers });
    if (this.failNext) {
      this.failNext = false;
      throw new Error("sink unreachable");
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
    SIGIL_CONFIG: JSON.stringify(config),
    SIGIL_SINK: "https://sigil.example.com/",
    SIGIL_KEY: "sg_demo_secret",
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
    expect(call.headers.authorization).toBe("Bearer sg_demo_secret");
    expect(call.body).not.toContain("sg_demo_secret");
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
        SIGIL_SINK: "https://sigil.example.com/",
        SIGIL_KEY: "sg_demo_secret",
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
  it("reports on the key alone, with no config at all", async () => {
    // The state this file used to call "half-configured" and refuse to act
    // on. It is now simply an enrolled app: the sink has a default and the key
    // names its own project, so there is no second half left to be missing.
    const alepha = make({ SIGIL_KEY: "sg_demo_secret" });
    const sink = alepha.inject(SigilSinkProvider);

    await expect(alepha.start()).resolves.toBeDefined();
    expect(sink.hasSink()).toBe(true);
    expect(sink.project()).toBe("demo");
    expect(sink.sinkOrigin()).toBe(SIGIL_DEFAULT_SINK);
    expect(sink.feedbackUrl()).toBe(`${SIGIL_DEFAULT_SINK}/demo/request`);
  });

  it("stays inert and boots when a config arrives without a key", async () => {
    const alepha = make({ SIGIL_CONFIG: '{"vitals":false}' });
    const sink = alepha.inject(SigilSinkProvider);

    await expect(alepha.start()).resolves.toBeDefined();
    expect(sink.hasSink()).toBe(false);
  });

  it("captures locally rather than sending when there is no key", async () => {
    const alepha = make();
    const sink = alepha.inject(SigilSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();

    await sink.ingest({ errors: [anError("boom")] });
    await sink.flush();

    expect(http.calls).toHaveLength(0);
  });

  it("keeps reporting for a key minted before the slug moved in", async () => {
    // The migration case, and the one that decides whether rotating every
    // deployed app is urgent or merely tidy. Reporting needs the credential
    // and nothing else, so an old key loses the feedback link and not a
    // single event.
    const alepha = make({ SIGIL_KEY: "sg_Ab3xYz09QwErTyUi" });
    const sink = alepha.inject(SigilSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();

    expect(sink.hasSink()).toBe(true);
    expect(sink.project()).toBeUndefined();
    expect(sink.feedbackUrl()).toBeUndefined();

    await sink.ingest({ views: [{ path: "/" }] });
    await sink.flush();

    expect(ingests(http)).toHaveLength(1);
  });

  it("fills in a scheme the operator did not paste", async () => {
    // A bare hostname is concatenated into a fetch URL and into the feedback
    // link, where it silently becomes a relative path: the flush hits the
    // app's own origin and the link points back into the app.
    const alepha = make({
      SIGIL_KEY: "sg_demo_secret",
      SIGIL_SINK: "lore.example.com",
    });
    const sink = alepha.inject(SigilSinkProvider);
    await alepha.start();

    expect(sink.sinkOrigin()).toBe("https://lore.example.com");
    expect(sink.feedbackUrl()).toBe("https://lore.example.com/demo/request");
  });

  it("leaves a scheme the operator did paste alone", async () => {
    const alepha = make({
      SIGIL_KEY: "sg_demo_secret",
      SIGIL_SINK: "http://localhost:3303/",
    });
    const sink = alepha.inject(SigilSinkProvider);
    await alepha.start();

    expect(sink.sinkOrigin()).toBe("http://localhost:3303");
  });

  /**
   * On the server a batch spans REQUESTS, so the flush window routinely holds
   * events from several visitors. There used to be one `pendingStamp` per
   * batch, last writer wins, so every visitor in the window was attributed to
   * whoever happened to be last: uniques collapsed toward one and the
   * geography was that of the final request.
   */
  describe("several visitors in one batch", () => {
    it("sends one envelope per stamp, each with its own visitor and country", async () => {
      const alepha = withSink();
      const sink = alepha.inject(SigilSinkProvider);
      const http = alepha.inject(HttpClient) as RecordingHttpClient;
      await alepha.start();

      await sink.ingest(
        { views: [{ path: "/a" }] },
        { visitor: "alice", country: "FR", device: "desktop" },
      );
      await sink.ingest(
        { views: [{ path: "/b" }] },
        { visitor: "bob", country: "JP", device: "mobile" },
      );
      await sink.flush();

      const sent = ingests(http).map((c) => JSON.parse(c.body));
      expect(sent).toHaveLength(2);

      const byVisitor = new Map(sent.map((e) => [e.visitor, e]));
      expect([...byVisitor.keys()].sort((a, b) => a.localeCompare(b))).toEqual([
        "alice",
        "bob",
      ]);
      expect(byVisitor.get("alice")).toMatchObject({
        country: "FR",
        device: "desktop",
        views: [{ path: "/a" }],
      });
      expect(byVisitor.get("bob")).toMatchObject({
        country: "JP",
        device: "mobile",
        views: [{ path: "/b" }],
      });
    });

    it("keeps one visitor's events together across requests", async () => {
      const alepha = withSink();
      const sink = alepha.inject(SigilSinkProvider);
      const http = alepha.inject(HttpClient) as RecordingHttpClient;
      await alepha.start();

      await sink.ingest({ views: [{ path: "/a" }] }, { visitor: "alice" });
      await sink.ingest({ views: [{ path: "/x" }] }, { visitor: "bob" });
      await sink.ingest({ views: [{ path: "/b" }] }, { visitor: "alice" });
      await sink.flush();

      const sent = ingests(http).map((c) => JSON.parse(c.body));
      expect(sent).toHaveLength(2);

      const alice = sent.find((e) => e.visitor === "alice");
      // Both of Alice's views, in one envelope, not split across two.
      expect(alice.views.map((v: any) => v.path)).toEqual(["/a", "/b"]);
    });

    it("carries a remainder forward under its own stamp", async () => {
      const alepha = withSink();
      const sink = alepha.inject(SigilSinkProvider);
      const http = alepha.inject(HttpClient) as RecordingHttpClient;
      await alepha.start();

      // Over the 50-view cap for alice, one view for bob.
      await sink.ingest(
        { views: Array.from({ length: 50 }, (_, i) => ({ path: `/a${i}` })) },
        { visitor: "alice" },
      );
      await sink.ingest(
        { views: Array.from({ length: 30 }, (_, i) => ({ path: `/z${i}` })) },
        { visitor: "alice" },
      );
      await sink.ingest({ views: [{ path: "/b" }] }, { visitor: "bob" });

      await sink.flush();
      await sink.flush();

      const sent = ingests(http).map((c) => JSON.parse(c.body));
      const alice = sent.filter((e) => e.visitor === "alice");
      // 80 views over a cap of 50: two envelopes, and the remainder is still
      // Alice's rather than whoever flushes next.
      expect(alice).toHaveLength(2);
      expect(alice[0].views).toHaveLength(50);
      expect(alice[1].views).toHaveLength(30);
      expect(sent.filter((e) => e.visitor === "bob")).toHaveLength(1);
    });
  });
});

/**
 * A credential is not permission to report from anywhere.
 *
 * The module's own documentation said "active in production only" while only
 * the BROWSER half was gated: with `SIGIL_KEY` set, every `alepha dev`
 * session, test container and CI job delivered to the sink, so the numbers an
 * operator reads to decide things included the developer refreshing a page.
 */
describe("SigilSinkProvider outside production", () => {
  const inDev = (config: Record<string, any> = {}) =>
    withSink(config, { NODE_ENV: "development" });

  it("captures locally and sends nothing", async () => {
    const alepha = inDev();
    const sink = alepha.inject(SigilSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();

    await sink.ingest({ errors: [anError("boom")] });
    await sink.flush();

    // The credential is there - this is a decision about the environment, not
    // a missing key.
    expect(sink.hasSink()).toBe(true);
    expect(sink.reports()).toBe(false);
    expect(ingests(http)).toHaveLength(0);
  });

  /**
   * The one real case for turning it back on: a staging deployment proving its
   * enrolment works before production has to.
   */
  it("reports when SIGIL_CONFIG says to", async () => {
    const alepha = inDev({ reportOutsideProduction: true });
    const sink = alepha.inject(SigilSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();

    await sink.ingest({ errors: [anError("boom")] });
    await sink.flush();

    expect(sink.reports()).toBe(true);
    expect(ingests(http)).toHaveLength(1);
  });

  it("reports in production without being asked", async () => {
    const alepha = withSink();
    const sink = alepha.inject(SigilSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();

    await sink.ingest({ errors: [anError("boom")] });
    await sink.flush();

    expect(sink.reports()).toBe(true);
    expect(ingests(http)).toHaveLength(1);
  });

  /**
   * The feedback URL is a LINK to the sink's own page, not a report, and it is
   * built from the key. Gating it on the environment too would take the button
   * away exactly where it is most useful.
   */
  it("still offers the feedback link in development", async () => {
    const alepha = inDev();
    const sink = alepha.inject(SigilSinkProvider);
    await alepha.start();

    expect(sink.feedbackUrl()).toBe("https://sigil.example.com/demo/request");
  });
});
