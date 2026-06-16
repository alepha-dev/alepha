import { Alepha } from "alepha";
import { ServerReply } from "alepha/server";
import { describe, expect, it } from "vitest";
import { SigilForwardProvider } from "../SigilForwardProvider.ts";
import { SigilProxyController } from "../SigilProxyController.ts";

class FakeForward extends SigilForwardProvider {
  public ingested: Array<{ env: any; stamp: any }> = [];

  enabled() {
    return true;
  }

  id() {
    return "sig-1";
  }

  async forwardIngest(env: any, stamp: any) {
    this.ingested.push({ env, stamp });
  }
}

const make = () =>
  Alepha.create({
    env: { NODE_ENV: "production", SERVER_PORT: 0, SIGIL_ID: "sig-1" },
  }).with({ provide: SigilForwardProvider, use: FakeForward });

describe("SigilProxyController.ingest", () => {
  it("stamps country + a stable visitor hash from the request edge and forwards", async () => {
    const alepha = make();
    const ctrl = alepha.inject(SigilProxyController);
    await alepha.start();

    await ctrl.ingest.run({
      body: { views: [{ path: "/" }] },
      headers: {
        "cf-ipcountry": "FR",
        "cf-connecting-ip": "1.2.3.4",
        "user-agent": "UA",
      },
    });

    const fwd = alepha.inject(SigilForwardProvider) as FakeForward;
    expect(fwd.ingested[0].stamp.country).toBe("FR");
    expect(typeof fwd.ingested[0].stamp.visitor).toBe("string");
    expect(fwd.ingested[0].stamp.visitor.length).toBeGreaterThan(0);
  });

  it("stable visitor hash: same edge inputs same day → same hash", async () => {
    const alepha = make();
    const ctrl = alepha.inject(SigilProxyController);
    await alepha.start();

    const headers = {
      "cf-ipcountry": "FR",
      "cf-connecting-ip": "1.2.3.4",
      "user-agent": "UA",
    };

    await ctrl.ingest.run({ body: { views: [] }, headers });
    await ctrl.ingest.run({ body: { views: [] }, headers });

    const fwd = alepha.inject(SigilForwardProvider) as FakeForward;
    expect(fwd.ingested[0].stamp.visitor).toBe(fwd.ingested[1].stamp.visitor);
  });

  it("returns ok: false and does not forward when provider is disabled", async () => {
    class DisabledForward extends SigilForwardProvider {
      public ingested: Array<{ env: any; stamp: any }> = [];

      enabled() {
        return false;
      }

      async forwardIngest(env: any, stamp: any) {
        this.ingested.push({ env, stamp });
      }
    }

    const alepha = Alepha.create({
      env: { NODE_ENV: "production", SERVER_PORT: 0 },
    }).with({ provide: SigilForwardProvider, use: DisabledForward });
    const ctrl = alepha.inject(SigilProxyController);
    await alepha.start();

    const result = await ctrl.ingest.run({
      body: { views: [{ path: "/" }] },
      headers: {},
    });

    expect(result.ok).toBe(false);
    expect(
      (alepha.inject(SigilForwardProvider) as DisabledForward).ingested,
    ).toHaveLength(0);
  });

  it("country is undefined when cf-ipcountry header is absent", async () => {
    const alepha = make();
    const ctrl = alepha.inject(SigilProxyController);
    await alepha.start();

    await ctrl.ingest.run({
      body: { views: [] },
      headers: { "cf-connecting-ip": "5.5.5.5", "user-agent": "bot" },
    });

    const fwd = alepha.inject(SigilForwardProvider) as FakeForward;
    expect(fwd.ingested[0].stamp.country).toBeUndefined();
  });

  it("drops buckets whose feature is disabled before forwarding", async () => {
    class FilteredForward extends SigilForwardProvider {
      public ingested: Array<{ env: any; stamp: any }> = [];

      enabled() {
        return true;
      }

      id() {
        return "sig-1";
      }

      features() {
        return ["blights" as const];
      }

      async forwardIngest(env: any, stamp: any) {
        this.ingested.push({ env, stamp });
      }
    }

    const alepha = Alepha.create({
      env: { NODE_ENV: "production", SERVER_PORT: 0, SIGIL_ID: "sig-1" },
    }).with({ provide: SigilForwardProvider, use: FilteredForward });
    const ctrl = alepha.inject(SigilProxyController);
    await alepha.start();

    await ctrl.ingest.run({
      body: {
        views: [{ path: "/" }],
        errors: [{ name: "E", message: "m", stack: "", sourceUrl: "" }],
        vitals: [{ path: "/", metric: "lcp", value: 1 }],
      },
      headers: {},
    });

    const fwd = alepha.inject(SigilForwardProvider) as FilteredForward;
    expect(fwd.ingested).toHaveLength(1);
    // Only the blights bucket survives the feature filter.
    expect(fwd.ingested[0].env.errors).toBeDefined();
    expect(fwd.ingested[0].env.views).toBeUndefined();
    expect(fwd.ingested[0].env.vitals).toBeUndefined();
  });
});

describe("SigilProxyController.request", () => {
  it("302-redirects to the Lore petition page for the resolved campaign", async () => {
    class RedirectForward extends SigilForwardProvider {
      enabled() {
        return true;
      }

      loreOrigin() {
        return "https://lore.test";
      }

      async campaignId() {
        return 7;
      }
    }

    const alepha = Alepha.create({
      env: { NODE_ENV: "production", SERVER_PORT: 0, SIGIL_ID: "sig-1" },
    }).with({ provide: SigilForwardProvider, use: RedirectForward });
    const ctrl = alepha.inject(SigilProxyController);
    await alepha.start();

    const reply = new ServerReply();
    await ctrl.request.run({ reply });

    expect(reply.status).toBe(302);
    expect(reply.headers.location).toBe("https://lore.test/c/7/request");
  });

  it("forwards whitelisted page-context params and drops unknown ones", async () => {
    class RedirectForward extends SigilForwardProvider {
      enabled() {
        return true;
      }

      loreOrigin() {
        return "https://lore.test";
      }

      async campaignId() {
        return 7;
      }
    }

    const alepha = Alepha.create({
      env: { NODE_ENV: "production", SERVER_PORT: 0, SIGIL_ID: "sig-1" },
    }).with({ provide: SigilForwardProvider, use: RedirectForward });
    const ctrl = alepha.inject(SigilProxyController);
    await alepha.start();

    const reply = new ServerReply();
    const url = new URL(
      "https://partner.example.com/sigil/request" +
        "?url=https%3A%2F%2Fshop.example.com%2Fcheckout" +
        "&ua=Mozilla%2F5.0" +
        "&tz=Europe%2FParis" +
        "&evil=DROP%20TABLE", // not whitelisted — must be dropped
    );
    await ctrl.request.run({ reply, url });

    expect(reply.status).toBe(302);
    const location = new URL(reply.headers.location as string);
    expect(location.origin + location.pathname).toBe(
      "https://lore.test/c/7/request",
    );
    expect(location.searchParams.get("url")).toBe(
      "https://shop.example.com/checkout",
    );
    expect(location.searchParams.get("ua")).toBe("Mozilla/5.0");
    expect(location.searchParams.get("tz")).toBe("Europe/Paris");
    // Whitelist only — arbitrary params never reach the Lore URL.
    expect(location.searchParams.has("evil")).toBe(false);
  });
});
