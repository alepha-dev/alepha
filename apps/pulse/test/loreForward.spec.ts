import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { CryptoProvider } from "alepha/crypto";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpClient } from "alepha/server";
import { AlephaServerCors } from "alepha/server/cors";
import { describe, expect, it } from "vitest";
import { SourceIngestController } from "../../lore/src/api/controllers/SourceIngestController.ts";
import { blights } from "../../lore/src/api/entities/blights.ts";
import { campaignSources } from "../../lore/src/api/entities/campaignSources.ts";
import { campaigns } from "../../lore/src/api/entities/campaigns.ts";
import { LoreApi } from "../../lore/src/api/index.ts";
import { errorGroups } from "../src/api/entities/errorGroups.ts";
import { pulseApps } from "../src/api/entities/pulseApps.ts";
import { PulseApi } from "../src/api/index.ts";
import { LoreForwardService } from "../src/api/services/LoreForwardService.ts";

/**
 * Pulse forwarding into a REAL Lore, not a stub.
 *
 * This path had never run. Both halves were written, reviewed and merged, and
 * every assumption about how they fit was untested — which is exactly where the
 * two defects below were living. A fake Lore would have agreed with whatever
 * Pulse sent, so the whole point is that the receiving end is the actual
 * controller, with its actual schema.
 */

const LORE_TOKEN = "src_test_token";

class LoreProbe {
  campaigns = $repository(campaigns);
  sources = $repository(campaignSources);
  blights = $repository(blights);
}

class PulseProbe {
  apps = $repository(pulseApps);
  errors = $repository(errorGroups);
}

const startLore = async () => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      SERVER_HOST: "127.0.0.1",
      DATABASE_URL: ":memory:",
    },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaServerCors);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);

  const probe = alepha.inject(LoreProbe);
  const crypto = alepha.inject(CryptoProvider);
  const ingest = alepha.inject(SourceIngestController);
  await alepha.start();

  const campaign = await probe.campaigns.create({
    name: "Test",
    title: "Test",
    createdBy: "00000000-0000-4000-8000-000000000001",
  } as any);
  await probe.sources.create({
    campaignId: campaign.id,
    name: "Pulse",
    tokenHash: crypto.hash(LORE_TOKEN),
    tokenPrefix: "src_test",
    scopes: ["blight:write"],
  } as any);

  return { alepha, probe, campaign, ingest };
};

/**
 * Routes Pulse's outbound call into Lore's controller, in process.
 *
 * Substituted rather than mocked: what is under test is whether the two
 * contracts agree, so the request has to be handed to the real handler and its
 * real schema — a recorded call proves only that Pulse sent something.
 */
const startPulse = async (
  lore: Awaited<ReturnType<typeof startLore>>,
  env: Record<string, unknown> = {},
) => {
  class LoreRoutingHttpClient extends HttpClient {
    public lastUrl?: string;
    async fetch(url: string, opts: any): Promise<any> {
      this.lastUrl = url;
      const body = JSON.parse(opts.body);
      const result = await (lore.ingest as any).ingestBlights(
        { body, headers: { authorization: opts.headers.authorization } },
        {},
      );
      return { data: result, status: 200 };
    }
  }

  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      APP_SECRET: "test-secret-for-lore-forwarding",
      DATABASE_URL: ":memory:",
      PUBLIC_URL: "https://pulse.example.com",
      ...env,
    },
  })
    // Substituted BEFORE the module: registering PulseApi first injects
    // HttpClient on the way, and the container refuses a substitution for a
    // service already resolved.
    .with({ provide: HttpClient, use: LoreRoutingHttpClient })
    .with(PulseApi);

  const probe = alepha.inject(PulseProbe);
  const forward = alepha.inject(LoreForwardService);
  const http = alepha.inject(HttpClient) as LoreRoutingHttpClient;
  await alepha.start();

  return { alepha, probe, forward, http };
};

const setup = async (env: Record<string, unknown> = {}) => {
  const lore = await startLore();
  const pulse = await startPulse(lore, env);

  // Encrypted exactly the way `configureLore` does it. The envelope carries
  // the salt, and `keyOf` re-derives from APP_SECRET to open it — storing the
  // token in clear here fails with "Invalid protected envelope", which is the
  // fixture being wrong rather than the round-trip.
  const crypto = pulse.alepha.inject(CryptoProvider);
  const salt = "00112233445566778899aabbccddeeff";
  const keyCipher = await crypto.encryptWithPassphrase(
    LORE_TOKEN,
    await crypto.deriveKeyFromPassphrase(
      "test-secret-for-lore-forwarding",
      salt,
    ),
    salt,
  );

  const app = await pulse.probe.apps.create({
    slug: "demo",
    name: "Demo",
    kind: "external",
    ingestKeyHash: "hash",
    ingestKeyPrefix: "tk_demo",
    lore: {
      url: "https://lore.example.com",
      campaignId: lore.campaign.id,
      keyCipher,
    },
  } as any);

  await pulse.probe.errors.create({
    appId: app.id,
    fingerprint: "fp-forwarded",
    name: "TypeError",
    message: "Cannot read properties of undefined",
    stackSample: "TypeError\n    at cart (app.js:1:1)",
    sourceUrl: "https://demo.example.com/cart",
    origin: "client",
    count: 7,
    firstSeenAt: "2026-08-01T10:00:00.000Z",
    lastSeenAt: "2026-08-01T10:05:00.000Z",
  } as any);

  return { lore, pulse, app };
};

describe("Pulse → Lore, against the real receiver", () => {
  it("should file an error group as a blight", async () => {
    const { lore, pulse } = await setup();

    await pulse.forward.collect();
    const { sent, failed } = await pulse.forward.drain();

    expect({ sent, failed }).toEqual({ sent: 1, failed: 0 });

    const filed = await lore.probe.blights.findMany({});
    expect(filed).toHaveLength(1);
    expect(filed[0]).toMatchObject({
      fingerprint: "fp-forwarded",
      name: "TypeError",
      // The count travels: a blight that says "seen once" for something that
      // happened seven times is worse than no count at all.
      count: 7,
    });
  });

  it("should link back to the group in Pulse with a URL Lore can actually open", async () => {
    /*
      `pulseUrl` was a bare path. Rendered in Lore, a relative link resolves
      against LORE's origin — so the one click that is supposed to take someone
      from a blight to the error that caused it landed on a Lore page that does
      not exist.
    */
    const { lore, pulse } = await setup();

    await pulse.forward.collect();
    await pulse.forward.drain();

    const filed = await lore.probe.blights.findMany({});
    expect(filed[0].pulseUrl).toBe(
      "https://pulse.example.com/apps/demo?view=errors",
    );
  });

  it("should not forward the same group twice", async () => {
    // `forwardedAt` is what stops a nightly job re-filing the whole history
    // every run, which would make every count in Lore meaningless.
    const { lore, pulse } = await setup();

    await pulse.forward.collect();
    await pulse.forward.drain();
    const queued = await pulse.forward.collect();

    expect(queued).toBe(0);
    expect(await lore.probe.blights.findMany({})).toHaveLength(1);
  });

  it("should forward again once the group has been seen since", async () => {
    // The opposite failure: a bug that keeps happening must keep updating, or
    // Lore shows a stale count and a `lastSeenAt` from last week.
    const { lore, pulse, app } = await setup();

    await pulse.forward.collect();
    await pulse.forward.drain();

    const group = (await pulse.probe.errors.findMany({}))[0];
    await pulse.probe.errors.updateById(group.id, {
      count: 9,
      lastSeenAt: "2026-08-01T12:00:00.000Z",
    } as any);

    expect(await pulse.forward.collect()).toBe(1);
    await pulse.forward.drain();

    const filed = await lore.probe.blights.findMany({});
    expect(filed).toHaveLength(1);
    expect(filed[0].lastSeenAt).toBe("2026-08-01T12:00:00.000Z");
    void app;
  });

  it("should send no link at all when Pulse does not know its own origin", async () => {
    // A half-built link is worse than none: it is only discovered by clicking
    // it, and by then the person is on a 404 wondering whether the blight is
    // real.
    const { lore, pulse } = await setup({ PUBLIC_URL: "" });

    await pulse.forward.collect();
    await pulse.forward.drain();

    const filed = await lore.probe.blights.findMany({});
    expect(filed).toHaveLength(1);
    expect(filed[0].pulseUrl ?? "").toBe("");
  });
});
