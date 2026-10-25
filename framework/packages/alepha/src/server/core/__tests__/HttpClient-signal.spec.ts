import { $inject, AbortedError, Alepha } from "alepha";
import { describe, it } from "vitest";

import { $route, AlephaServer, HttpClient, ServerProvider } from "../index.ts";

/**
 * Outbound calls inherit the ambient signal (#E85): a request whose client
 * left stops the calls it made, without anyone threading a signal.
 */
describe("HttpClient ambient signal", () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  /**
   * An upstream route that holds its response until its own client leaves,
   * and reports when that happens.
   */
  const upstream = (method: "GET" | "POST" = "GET") => {
    const hits: string[] = [];
    const left = deferred();
    let release: () => void = () => {};
    const released = new Promise<void>((r) => {
      release = r;
    });
    class Upstream {
      slow = $route({
        method,
        path: "/upstream",
        handler: async ({ signal, query }) => {
          hits.push(String(query.who ?? "?"));
          signal.addEventListener("abort", () => left.resolve());
          await Promise.race([
            released,
            new Promise((r) => signal.addEventListener("abort", r)),
          ]);
          return "upstream answer";
        },
      });
    }
    return { Upstream, hits, left, release: () => release() };
  };

  it("aborts the outbound fetch when the inbound client disconnects", async ({
    expect,
  }) => {
    const { Upstream, left } = upstream("POST");
    const started = deferred();
    let outcome: unknown;

    class Front {
      http = $inject(HttpClient);
      server = $inject(ServerProvider);
      alepha = $inject(Alepha);
      front = $route({
        path: "/front",
        handler: async () => {
          started.resolve();
          try {
            await this.http.fetch(`${this.server.hostname}/upstream`, {
              method: "POST",
            });
          } catch (error) {
            outcome = error;
            throw error;
          }
          return "front answer";
        },
      });
    }

    const alepha = Alepha.create()
      .with(Upstream)
      .with(Front)
      .with(AlephaServer);
    await alepha.start();
    const hostname = alepha.inject(ServerProvider).hostname;

    const client = new AbortController();
    const response = fetch(`${hostname}/front`, { signal: client.signal });
    await started.promise;
    // Let the outbound call reach the upstream first.
    await new Promise((r) => setTimeout(r, 50));
    client.abort();
    await response.catch(() => undefined);

    // The upstream saw its own client (our HttpClient) leave.
    await left.promise;
    await new Promise((r) => setTimeout(r, 20));
    expect(alepha.context.isAbortError(outcome)).toBe(true);
  });

  it("composes an explicit signal with the ambient one: either aborts the call", async ({
    expect,
  }) => {
    const { Upstream, release } = upstream("POST");
    const alepha = Alepha.create().with(Upstream).with(AlephaServer);
    await alepha.start();
    const http = alepha.inject(HttpClient);
    const url = `${alepha.inject(ServerProvider).hostname}/upstream`;

    // Ambient aborts, explicit does not.
    const ambient = new AbortController();
    const viaAmbient = alepha.context.run(
      () =>
        http.fetch(url, {
          method: "POST",
          signal: new AbortController().signal,
        }),
      { signal: ambient.signal },
    );
    ambient.abort(new AbortedError("ambient"));
    await expect(viaAmbient).rejects.toBe(ambient.signal.reason);

    // Explicit aborts, ambient does not.
    const explicit = new AbortController();
    const viaExplicit = alepha.context.run(
      () => http.fetch(url, { method: "POST", signal: explicit.signal }),
      { signal: new AbortController().signal },
    );
    explicit.abort(new AbortedError("explicit"));
    await expect(viaExplicit).rejects.toBe(explicit.signal.reason);

    release();
  });

  it("serves a deduplicated GET to the caller that stayed when the other one leaves", async ({
    expect,
  }) => {
    const { Upstream, hits, left, release } = upstream();
    const alepha = Alepha.create().with(Upstream).with(AlephaServer);
    await alepha.start();
    const http = alepha.inject(HttpClient);
    const url = `${alepha.inject(ServerProvider).hostname}/upstream?who=shared`;

    const leaver = new AbortController();
    const stayer = new AbortController();
    const first = alepha.context.run(() => http.fetch(url), {
      signal: leaver.signal,
    });
    const second = alepha.context.run(() => http.fetch(url), {
      signal: stayer.signal,
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(hits).toEqual(["shared"]);

    leaver.abort(new AbortedError("first visitor left"));
    await expect(first).rejects.toBe(leaver.signal.reason);

    release();
    const answer = await second;
    expect(answer.data).toBe("upstream answer");
    // The shared fetch was never cut short.
    let upstreamLeft = false;
    void left.promise.then(() => {
      upstreamLeft = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(upstreamLeft).toBe(false);
  });

  it("aborts a deduplicated GET once its last caller has left", async ({
    expect,
  }) => {
    const { Upstream, left } = upstream();
    const alepha = Alepha.create().with(Upstream).with(AlephaServer);
    await alepha.start();
    const http = alepha.inject(HttpClient);
    const url = `${alepha.inject(ServerProvider).hostname}/upstream?who=both`;

    const a = new AbortController();
    const b = new AbortController();
    const first = alepha.context.run(() => http.fetch(url), {
      signal: a.signal,
    });
    const second = alepha.context.run(() => http.fetch(url), {
      signal: b.signal,
    });
    await new Promise((r) => setTimeout(r, 50));

    a.abort(new AbortedError("a left"));
    b.abort(new AbortedError("b left"));
    await expect(first).rejects.toBe(a.signal.reason);
    await expect(second).rejects.toBe(b.signal.reason);

    await left.promise;
  });
});
