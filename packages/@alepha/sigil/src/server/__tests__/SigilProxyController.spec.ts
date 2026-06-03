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
});
