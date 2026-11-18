import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { HttpClient, httpClientOptions } from "../index.ts";

/**
 * A read that got no HTTP answer is sent again, when `networkRetries` says
 * so (#Q3910): a connection reset between the caller and the edge says
 * nothing about the server.
 */
describe("HttpClient networkRetries", () => {
  /**
   * A transport that fails its first `failures` sends the way undici does on
   * a reset, then answers.
   */
  class FlakyHttpClient extends HttpClient {
    failures = 0;
    sent: string[] = [];
    answer = () => Response.json({ ok: true });

    protected override retryDelay(): number {
      return 0;
    }

    protected override async transport(
      _url: string,
      request: RequestInit,
    ): Promise<Response> {
      this.sent.push(request.method ?? "GET");
      if (this.sent.length <= this.failures) {
        throw new TypeError("fetch failed", {
          cause: new Error("read ECONNRESET"),
        });
      }
      return this.answer();
    }
  }

  const start = async (networkRetries?: number) => {
    const alepha = Alepha.create().with(FlakyHttpClient);
    if (networkRetries !== undefined) {
      alepha.store.mut(httpClientOptions, (options) => ({
        ...options,
        networkRetries,
      }));
    }
    await alepha.start();
    return alepha.inject(FlakyHttpClient);
  };

  it("sends a GET again after a reset", async ({ expect }) => {
    const http = await start(2);
    http.failures = 2;

    const { data } = await http.fetch("http://upstream.test/hosts");

    expect(data).toEqual({ ok: true });
    expect(http.sent).toEqual(["GET", "GET", "GET"]);
  });

  it("gives up past the bound, with the transport's own error", async ({
    expect,
  }) => {
    const http = await start(2);
    http.failures = 3;

    await expect(http.fetch("http://upstream.test/hosts")).rejects.toThrow(
      "fetch failed",
    );
    expect(http.sent).toHaveLength(3);
  });

  it("retries nothing by default", async ({ expect }) => {
    const http = await start();
    http.failures = 1;

    await expect(http.fetch("http://upstream.test/hosts")).rejects.toThrow(
      "fetch failed",
    );
    expect(http.sent).toHaveLength(1);
  });

  it("never sends a write again", async ({ expect }) => {
    const http = await start(2);
    http.failures = 1;

    await expect(
      http.fetch("http://upstream.test/deployments", {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toThrow("fetch failed");
    expect(http.sent).toEqual(["POST"]);
  });

  it("never sends an aborted call again", async ({ expect }) => {
    const http = await start(2);
    http.failures = 1;
    const controller = new AbortController();
    controller.abort();

    await expect(
      http.fetch("http://upstream.test/hosts", { signal: controller.signal }),
    ).rejects.toThrow();
    expect(http.sent.length).toBeLessThanOrEqual(1);
  });

  it("takes an HTTP error as an answer", async ({ expect }) => {
    const http = await start(2);
    http.answer = () => new Response("down", { status: 503 });

    await expect(http.fetch("http://upstream.test/hosts")).rejects.toThrow();
    expect(http.sent).toHaveLength(1);
  });
});
