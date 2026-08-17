import { Alepha } from "alepha";
import { HttpClient } from "alepha/server";
import { describe, expect, it } from "vitest";
import { SigilSinkProvider } from "../SigilSinkProvider.ts";

class RecordingHttpClient extends HttpClient {
  public calls: Array<{ url: string; body: any }> = [];

  async fetch(url: string, opts: any): Promise<any> {
    this.calls.push({ url, body: opts?.body });
    if (url.endsWith("/sigils/config")) return { data: {}, status: 200 } as any;
    return { data: {}, status: 204 } as any;
  }
}

const make = () =>
  Alepha.create({
    env: {
      NODE_ENV: "production",
      APP_SECRET: "test-secret",
      SERVER_PORT: 0,
      SIGIL_CONFIG: '{"project":"demo","sink":"https://sigil.example.com/"}',
      SIGIL_KEY: "tk_secret",
      SIGIL_SALT: "salt_secret",
    },
  }).with({ provide: HttpClient, use: RecordingHttpClient });

const sentEnvelopes = (http: RecordingHttpClient) =>
  http.calls
    .filter((c) => c.url.endsWith("/sigils/ingest"))
    .map((c) => JSON.parse(c.body));

const views = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ path: `/p${from + i}` }));

describe("SigilSinkProvider overflow", () => {
  it("carries the over-cap remainder into the next batch instead of dropping it", async () => {
    // The regression guard for a silent data loss: this used to `slice` to the
    // cap and then clear everything, so 60 views in one call sent 50 and lost
    // 10 with no log. Reachable on Node, where a batch spans requests.
    const alepha = make();
    const provider = alepha.inject(SigilSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();

    // One call past the cap. `ingest` flushes inline once `isDue` sees the cap.
    await provider.ingest({ views: views(60) });

    const first = sentEnvelopes(http);
    expect(first).toHaveLength(1);
    expect(first[0].views).toHaveLength(50);

    // The remaining 10 are still held, not gone.
    await provider.flush();

    const all = sentEnvelopes(http);
    expect(all).toHaveLength(2);
    expect(all[1].views).toHaveLength(10);

    // Nothing was lost and nothing was duplicated.
    const paths = all.flatMap((e) => e.views.map((v: any) => v.path));
    expect(new Set(paths).size).toBe(60);
  });

  it("keeps the visitor stamp on the remainder", async () => {
    const alepha = make();
    const provider = alepha.inject(SigilSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();

    await provider.ingest(
      { views: views(60) },
      { country: "FR", visitor: "vhash" },
    );
    await provider.flush();

    const all = sentEnvelopes(http);
    expect(all).toHaveLength(2);
    // The second envelope describes the same visitor as the first — dropping
    // the stamp with the batch would under-count uniques for exactly the
    // visitors busy enough to overflow a cap.
    expect(all[1].visitor).toBe("vhash");
    expect(all[1].country).toBe("FR");
  });

  it("drains fully when nothing is over the cap", async () => {
    const alepha = make();
    const provider = alepha.inject(SigilSinkProvider);
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    await alepha.start();

    await provider.ingest({ views: views(3) });
    await provider.flush();
    await provider.flush();

    expect(sentEnvelopes(http)).toHaveLength(1);
  });
});
