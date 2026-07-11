import { Alepha } from "alepha";
import { HttpClient } from "alepha/server";
import { describe, expect, it } from "vitest";
import { SigilForwardProvider } from "../SigilForwardProvider.ts";

class RecordingHttpClient extends HttpClient {
  public calls: Array<{ url: string; body: any }> = [];

  async fetch(url: string, opts: any): Promise<any> {
    this.calls.push({ url, body: opts?.body });
    if (url.endsWith("/campaign")) {
      return { data: { campaignId: 7 }, status: 200 } as any;
    }
    return { data: {}, status: 204 } as any;
  }
}

const make = (env: Record<string, any>) =>
  Alepha.create({
    env: {
      NODE_ENV: "production",
      APP_SECRET: "test-secret",
      SERVER_PORT: 0,
      ...env,
    },
  }).with({
    provide: HttpClient,
    use: RecordingHttpClient,
  });

describe("SigilForwardProvider", () => {
  it("is disabled without SIGIL_ID and forwards nothing", async () => {
    const alepha = make({});
    const fwd = alepha.inject(SigilForwardProvider);
    await alepha.start();
    expect(fwd.enabled()).toBe(false);
    await fwd.forwardIngest({ views: [{ path: "/" }] }, { country: "FR" });
    expect(
      (alepha.inject(HttpClient) as RecordingHttpClient).calls,
    ).toHaveLength(0);
  });

  it("forwards to LORE_URL/sigils/:id/ingest when enabled", async () => {
    const alepha = make({ SIGIL_ID: "abc", LORE_URL: "https://lore.test" });
    const fwd = alepha.inject(SigilForwardProvider);
    await alepha.start();
    expect(fwd.enabled()).toBe(true);
    await fwd.forwardIngest({ views: [{ path: "/" }] }, { country: "FR" });
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    expect(http.calls[0].url).toBe("https://lore.test/sigils/abc/ingest");
    expect(JSON.parse(http.calls[0].body).country).toBe("FR");
  });

  it("defaults LORE_URL to https://lore.alepha.dev", async () => {
    const alepha = make({ SIGIL_ID: "abc" });
    const fwd = alepha.inject(SigilForwardProvider);
    await alepha.start();
    await fwd.forwardIngest({ views: [] }, {});
    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    expect(http.calls[0].url).toBe("https://lore.alepha.dev/sigils/abc/ingest");
  });

  it("campaignId() fetches /sigils/:id/campaign once and caches the result", async () => {
    const alepha = make({ SIGIL_ID: "abc", LORE_URL: "https://lore.test" });
    const fwd = alepha.inject(SigilForwardProvider);
    await alepha.start();

    expect(await fwd.campaignId()).toBe(7);

    const http = alepha.inject(HttpClient) as RecordingHttpClient;
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0].url).toBe("https://lore.test/sigils/abc/campaign");

    // A second call does NOT refetch — the cached value is returned.
    expect(await fwd.campaignId()).toBe(7);
    expect(http.calls).toHaveLength(1);
  });

  it("features() defaults to all when SIGIL_FEATURES is unset", async () => {
    const alepha = make({ SIGIL_ID: "abc" });
    const fwd = alepha.inject(SigilForwardProvider);
    await alepha.start();

    expect(fwd.features().sort()).toEqual(
      ["beacon", "blights", "petition", "vitals"].sort(),
    );
  });

  it("features() filters to the SIGIL_FEATURES allow-list", async () => {
    const alepha = make({ SIGIL_ID: "abc", SIGIL_FEATURES: "blights, beacon" });
    const fwd = alepha.inject(SigilForwardProvider);
    await alepha.start();

    expect(fwd.features().sort()).toEqual(["beacon", "blights"].sort());
  });

  it("campaignId() returns undefined when disabled", async () => {
    const alepha = make({});
    const fwd = alepha.inject(SigilForwardProvider);
    await alepha.start();

    expect(fwd.enabled()).toBe(false);
    expect(await fwd.campaignId()).toBeUndefined();
    expect(
      (alepha.inject(HttpClient) as RecordingHttpClient).calls,
    ).toHaveLength(0);
  });
});
