import { Alepha, z } from "alepha";
import { $action, HttpClient } from "alepha/server";
import { describe, it } from "vitest";

import { AlephaServerLinksClient, LinkProvider } from "../index.ts";

class Api {
  list = $action({
    path: "/list",
    method: "GET",
    schema: { response: z.text() },
    handler: () => "list",
  });

  count = $action({
    path: "/count",
    method: "GET",
    schema: { response: z.text() },
    handler: () => "count",
  });

  find = $action({
    path: "/find",
    method: "GET",
    schema: {
      headers: z.object({ uppercase: z.text().optional() }),
      response: z.text(),
    },
    handler: () => "find",
  });
}

/**
 * Records what reaches the network and answers it: a batch with each
 * action's name, a direct call with the `uppercase` header it carried.
 */
class RecordingHttpClient extends HttpClient {
  public readonly sent: Array<{ url: string; headers: Headers }> = [];

  protected override async transport(
    url: string,
    request: RequestInit,
  ): Promise<Response> {
    const headers = new Headers(request.headers);
    this.sent.push({ url, headers });
    // Long enough for a caller to abort while the request is in flight.
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (url.startsWith("/api/_batch")) {
      const entries: Array<{ action: string }> = JSON.parse(
        request.body as string,
      );
      return Response.json(
        entries.map(({ action }) => ({ action, status: 200, data: action })),
      );
    }
    return new Response(`uppercase=${headers.get("uppercase")}`, {
      headers: { "content-type": "text/plain" },
    });
  }

  public urls(): string[] {
    return this.sent.map((it) => it.url).sort();
  }

  public of(path: string) {
    return this.sent.filter((it) => it.url === path);
  }
}

const registry = {
  actions: {
    list: { path: "/list" },
    count: { path: "/count" },
    find: { path: "/find" },
  },
};

const setup = async () => {
  const alepha = Alepha.create()
    .with({ provide: HttpClient, use: RecordingHttpClient })
    .with(AlephaServerLinksClient);
  await alepha.start();
  alepha.store.set("alepha.server.request.apiLinks", registry);
  return {
    api: alepha.inject(LinkProvider).client<Api>(),
    scoped: (scope: {
      authorization?: string;
      headers?: Record<string, string>;
    }) => alepha.inject(LinkProvider).client<Api>(scope),
    network: alepha.inject(RecordingHttpClient),
  };
};

describe("LinkProvider batching and per-call options", () => {
  it("batches calls that carry params, query and body only", async ({
    expect,
  }) => {
    const { api, network } = await setup();

    const results = await Promise.all([api.list(), api.count(), api.find()]);

    expect(results).toEqual(["list", "count", "find"]);
    expect(network.urls()).toEqual(["/api/_batch?actions=list,count,find"]);
  });

  it("sends a call with config.headers on its own, with them", async ({
    expect,
  }) => {
    const { api, network } = await setup();

    const results = await Promise.all([
      api.list(),
      api.count(),
      api.find({ headers: { uppercase: "true" } }),
    ]);

    expect(results).toEqual(["list", "count", "uppercase=true"]);
    expect(network.urls()).toEqual([
      "/api/_batch?actions=list,count",
      "/api/find",
    ]);
  });

  it("sends a call with options.request headers on its own, with them", async ({
    expect,
  }) => {
    const { api, network } = await setup();

    await Promise.all([
      api.list(),
      api.count(),
      api.find({}, { request: { headers: { "x-trace": "abc" } } }),
    ]);

    expect(network.urls()).toEqual([
      "/api/_batch?actions=list,count",
      "/api/find",
    ]);
    expect(network.of("/api/find")[0].headers.get("x-trace")).toBe("abc");
  });

  it("keeps calls that pass only an abort signal in one batch, and aborting one rejects only that one", async ({
    expect,
  }) => {
    const { api, network } = await setup();
    const controllers = [0, 1, 2].map(() => new AbortController());
    const reason = new DOMException("left", "AbortError");

    const calls = Promise.allSettled([
      api.list({}, { request: { signal: controllers[0].signal } }),
      api.count({}, { request: { signal: controllers[1].signal } }),
      api.find({}, { request: { signal: controllers[2].signal } }),
    ]);
    // Past the 10 ms window: the batch request is in flight.
    await new Promise((resolve) => setTimeout(resolve, 25));
    controllers[1].abort(reason);
    const [list, count, find] = await calls;

    expect(network.urls()).toEqual(["/api/_batch?actions=list,count,find"]);
    expect(list).toStrictEqual({ status: "fulfilled", value: "list" });
    expect(count).toStrictEqual({ status: "rejected", reason });
    expect(find).toStrictEqual({ status: "fulfilled", value: "find" });
  });

  it("rejects a call whose signal aborts before the batch leaves, and does not send it", async ({
    expect,
  }) => {
    const { api, network } = await setup();
    const controller = new AbortController();
    const reason = new DOMException("left", "AbortError");

    const calls = Promise.allSettled([
      api.list(),
      api.count(),
      api.find({}, { request: { signal: controller.signal } }),
    ]);
    controller.abort(reason);
    const [list, count, find] = await calls;

    expect(network.urls()).toEqual(["/api/_batch?actions=list,count"]);
    expect(list).toStrictEqual({ status: "fulfilled", value: "list" });
    expect(count).toStrictEqual({ status: "fulfilled", value: "count" });
    expect(find).toStrictEqual({ status: "rejected", reason });
  });

  it("sends a call of a client with a credential or headers on its own", async ({
    expect,
  }) => {
    const { api, scoped, network } = await setup();

    await Promise.all([
      api.list(),
      api.count(),
      scoped({ authorization: "Bearer other" }).find(),
      scoped({ headers: { "x-tenant": "acme" } }).find(),
    ]);

    expect(network.urls()).toEqual([
      "/api/_batch?actions=list,count",
      "/api/find",
      "/api/find",
    ]);
    const direct = network.of("/api/find");
    expect(direct.map((it) => it.headers.get("authorization"))).toContain(
      "Bearer other",
    );
    expect(direct.map((it) => it.headers.get("x-tenant"))).toContain("acme");
  });

  /**
   * What is true today, not what should be. The two calls are no longer
   * merged by the batch, but they are still one request: `HttpClient` joins
   * same-tick GETs of one URL and one identity whatever their other headers
   * are, so the second caller receives the first one's answer.
   */
  it("sends two same-tick GETs differing only by a header unbatched, and HttpClient still joins them into one request", async ({
    expect,
  }) => {
    const { api, network } = await setup();

    const results = await Promise.all([
      api.find({ headers: { uppercase: "true" } }),
      api.find({ headers: { uppercase: "false" } }),
    ]);

    expect(network.urls()).toEqual(["/api/find"]);
    expect(network.of("/api/find")[0].headers.get("uppercase")).toBe("true");
    expect(results).toEqual(["uppercase=true", "uppercase=true"]);
  });
});
