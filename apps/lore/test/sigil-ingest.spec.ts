import { SIGIL_CONFIG_PATH, SIGIL_INGEST_PATH } from "@alepha/sigil/paths";
import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import { AlephaServerCors } from "alepha/server/cors";
import { describe, expect, it } from "vitest";
import { blights } from "../src/api/entities/blights.ts";
import { campaigns } from "../src/api/entities/campaigns.ts";
import { sigilErrorGroups } from "../src/api/entities/sigilErrorGroups.ts";
import { sigils } from "../src/api/entities/sigils.ts";
import { sigilUniquesDaily } from "../src/api/entities/sigilUniquesDaily.ts";
import { sigilViewsHourly } from "../src/api/entities/sigilViewsHourly.ts";
import { sigilVitalsHourly } from "../src/api/entities/sigilVitalsHourly.ts";
import { LoreApi } from "../src/api/index.ts";
import { BlightRuleService } from "../src/api/services/BlightRuleService.ts";
import { SigilTokenService } from "../src/api/services/SigilTokenService.ts";

class Probe {
  campaigns = $repository(campaigns);
  sigils = $repository(sigils);
  views = $repository(sigilViewsHourly);
  uniques = $repository(sigilUniquesDaily);
  vitals = $repository(sigilVitalsHourly);
  errorGroups = $repository(sigilErrorGroups);
  blights = $repository(blights);
}

/**
 * Boots a real HTTP server rather than calling handlers directly.
 *
 * The routes under test are `$route`, not `$action`, and the difference is
 * invisible to a handler call: it only shows up in the URL the server binds. A
 * route mistakenly declared as `$action` would answer every direct-call test
 * and 404 every real client.
 */
const setup = async (over: { kinds?: string[]; features?: unknown } = {}) => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      SERVER_HOST: "127.0.0.1",
      DATABASE_URL: ":memory:",
      PUBLIC_URL: "https://lore.test",
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

  const probe = alepha.inject(Probe);
  const tokens = alepha.inject(SigilTokenService);
  const server = alepha.inject(ServerProvider);
  const users = alepha.inject(UserService);
  await alepha.start();

  // A real user row: `blight_ignore_rules.createdBy` carries a foreign key to
  // it, so a made-up id fails the constraint rather than the assertion.
  const owner = await users.createUser({ username: "owner" });

  const campaign = await probe.campaigns.create({
    title: "Test",
    createdBy: owner.id,
    ...(over.features ? { features: over.features } : {}),
  } as any);

  const minted = tokens.mint();
  const sigil = await probe.sigils.create({
    campaignId: campaign.id,
    app: "demo",
    environment: "production",
    label: "demo / production",
    tokenHash: minted.hash,
    tokenPrefix: minted.prefix,
    kinds: over.kinds ?? ["beacon", "vitals", "blights", "petition"],
  });

  // Built from the package's own constants, not from literals. That is what
  // makes these tests a contract rather than a restatement: they prove the
  // sink serves the exact paths the cable calls, and they break if either side
  // moves. The cable fails open, so nothing else would notice.
  const post = (body: unknown, token: string | undefined = minted.token) =>
    fetch(`${server.hostname}${SIGIL_INGEST_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  const getConfig = (token: string | undefined = minted.token) =>
    fetch(`${server.hostname}${SIGIL_CONFIG_PATH}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  return {
    alepha,
    probe,
    owner,
    campaign,
    sigil,
    token: minted.token,
    post,
    getConfig,
  };
};

const anError = (over: Record<string, unknown> = {}) => ({
  name: "TypeError",
  message: "Cannot read properties of undefined",
  stack: "TypeError: boom\n    at cart (app.iHryQ0pA.js:12:3)",
  sourceUrl: "https://demo.example.com/cart",
  origin: "client",
  ...over,
});

describe("sigil ingest", () => {
  it("aggregates views on write instead of storing one row per hit", async () => {
    const { probe, sigil, post } = await setup();

    for (let i = 0; i < 5; i++) {
      const res = await post({ views: [{ path: "/home" }] });
      expect(res.status).toBe(204);
    }

    const rows = await probe.views.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(5);
  });

  it("refuses an unknown token", async () => {
    const { post } = await setup();

    const res = await post({ views: [{ path: "/" }] }, "sg_nope");
    expect(res.status).toBe(401);
  });

  it("ignores a kind the sigil does not carry", async () => {
    const { probe, sigil, post } = await setup({ kinds: ["blights"] });

    const res = await post({ views: [{ path: "/home" }] });
    expect(res.status).toBe(204);

    const rows = await probe.views.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(rows).toHaveLength(0);
  });

  /*
    One negative case per gate. A mistyped kind — `"blight"` for `"blights"` —
    does not throw, it silently disables that capability for every sigil
    forever, and the only symptom is a table that stays empty. `carries()` takes
    a `SigilKind` so the compiler catches the typo; these prove the three arms
    are wired to the three kinds they claim.
  */
  it("refuses vitals from a sigil without the vitals kind", async () => {
    const { probe, sigil, post } = await setup({
      kinds: ["beacon", "blights"],
    });

    const res = await post({
      vitals: [{ path: "/home", metric: "lcp", value: 900 }],
    });
    expect(res.status).toBe(204);

    expect(
      await probe.vitals.findMany({ where: { sigilId: { eq: sigil.id } } }),
    ).toHaveLength(0);
  });

  it("refuses errors from a sigil without the blights kind", async () => {
    const { probe, campaign, sigil, post } = await setup({
      kinds: ["beacon", "vitals"],
    });

    const res = await post({ errors: [anError()] });
    expect(res.status).toBe(204);

    // Neither table, not just the inbox.
    expect(
      await probe.errorGroups.findMany({
        where: { sigilId: { eq: sigil.id } },
      }),
    ).toHaveLength(0);
    expect(
      await probe.blights.findMany({
        where: { campaignId: { eq: campaign.id } },
      }),
    ).toHaveLength(0);
  });

  it("survives a proxy that stamps an empty country", async () => {
    const { probe, sigil, post } = await setup();

    // `country` is `z.string().max(8).optional()`, so `""` is valid on the
    // wire, and `sigil_views_hourly.country` is `min(1)`. `?? "ZZ"` does not
    // catch an empty string and the whole batch 500s.
    const res = await post({ views: [{ path: "/home" }], country: "" });
    expect(res.status).toBe(204);

    const rows = await probe.views.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].country).toBe("ZZ");
  });

  it("counts a visitor once a day however many pages they load", async () => {
    const { probe, sigil, post } = await setup();

    await post({ views: [{ path: "/a" }, { path: "/b" }], visitor: "v1" });
    await post({ views: [{ path: "/c" }], visitor: "v1" });
    await post({ views: [{ path: "/a" }], visitor: "v2" });

    const rows = await probe.uniques.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(rows).toHaveLength(2);
  });

  it("strips the query string so storage stays bounded by page count", async () => {
    const { probe, sigil, post } = await setup();

    await post({ views: [{ path: "/search?q=a" }] });
    await post({ views: [{ path: "/search?q=b" }] });

    const rows = await probe.views.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe("/search");
    expect(rows[0].count).toBe(2);
  });

  it("keeps vitals as bucket counts rather than samples", async () => {
    const { probe, sigil, post } = await setup();

    await post({ vitals: [{ path: "/home", metric: "lcp", value: 900 }] });
    await post({ vitals: [{ path: "/home", metric: "lcp", value: 950 }] });
    await post({ vitals: [{ path: "/home", metric: "lcp", value: 5000 }] });

    const rows = await probe.vitals.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(rows).toHaveLength(1);
    // 900 and 950 both land in the first bucket (<= 1000); 5000 in the fifth.
    expect(rows[0].bucketCounts).toEqual({ "0": 2, "5": 1 });
  });

  it("files an error into both the per-sigil group and the campaign inbox", async () => {
    const { probe, campaign, sigil, post } = await setup();

    await post({ errors: [anError({ count: 3 })] });
    await post({ errors: [anError({ count: 4 })] });

    // The per-environment truth: how bad is it *here*.
    const groups = await probe.errorGroups.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(7);
    expect(groups[0].forwardedAt).toBeTruthy();

    // The campaign-wide editorial decision: one row, one status.
    const inbox = await probe.blights.findMany({
      where: { campaignId: { eq: campaign.id } },
    });
    expect(inbox).toHaveLength(1);
    expect(inbox[0].count).toBe(7);
    expect(inbox[0].sigilId).toBe(sigil.id);
    expect(inbox[0].status).toBe("open");
  });

  it("keeps two environments apart in the groups and together in the inbox", async () => {
    const { alepha, probe, campaign, sigil, post } = await setup();

    const tokens = alepha.inject(SigilTokenService);
    const staging = tokens.mint();
    const other = await probe.sigils.create({
      campaignId: campaign.id,
      app: "demo",
      environment: "staging",
      label: "demo / staging",
      tokenHash: staging.hash,
      tokenPrefix: staging.prefix,
      kinds: ["blights"],
    });

    await post({ errors: [anError({ count: 2 })] });
    await post({ errors: [anError({ count: 5 })] }, staging.token);

    // Two budgets, because two environments.
    const groups = await probe.errorGroups.findMany({});
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.count).sort()).toEqual([2, 5]);

    // One triage decision, because one bug.
    const inbox = await probe.blights.findMany({
      where: { campaignId: { eq: campaign.id } },
    });
    expect(inbox).toHaveLength(1);
    expect(inbox[0].count).toBe(7);
    // Last reporter wins, which is what the inbox filter means by "sigil".
    expect(inbox[0].sigilId).toBe(other.id);
  });

  it("keeps a triage decision when the same bug is reported again", async () => {
    const { probe, campaign, post } = await setup();

    await post({ errors: [anError({ count: 2 })] });
    const [filed] = await probe.blights.findMany({
      where: { campaignId: { eq: campaign.id } },
    });
    await probe.blights.updateById(filed.id, { status: "resolved" });

    // The load-bearing half of the "one row per campaign" ruling: the whole
    // reason `blights` is keyed by campaign rather than by sigil is that a
    // triage decision must not fork. If `status` ever joins the upsert's `set`
    // clause, resolving a bug becomes a decision the next batch undoes.
    await post({ errors: [anError({ count: 3 })] });

    const rows = await probe.blights.findMany({
      where: { campaignId: { eq: campaign.id } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("resolved");
    // Still counted, though — the bug is still happening, it is just triaged.
    expect(rows[0].count).toBe(5);
  });

  it("drops a muted message before it reaches either table", async () => {
    const { alepha, probe, owner, campaign, sigil, post } = await setup();

    await alepha
      .inject(BlightRuleService)
      .create(campaign.id, "ResizeObserver", owner.id);

    await post({
      errors: [anError({ message: "ResizeObserver loop limit exceeded" })],
    });

    // Filtering on read would let a muted error keep growing both tables and
    // keep inflating every count.
    expect(
      await probe.errorGroups.findMany({
        where: { sigilId: { eq: sigil.id } },
      }),
    ).toHaveLength(0);
    expect(
      await probe.blights.findMany({
        where: { campaignId: { eq: campaign.id } },
      }),
    ).toHaveLength(0);
  });

  it("marks the sigil as seen even when every kind is switched off", async () => {
    const { probe, sigil, post } = await setup({ kinds: [] });

    expect(sigil.lastSeenAt).toBeUndefined();
    const res = await post({ views: [{ path: "/home" }] });
    expect(res.status).toBe(204);

    const after = await probe.sigils.findOne({
      where: { id: { eq: sigil.id } },
    });
    expect(after?.lastSeenAt).toBeTruthy();
  });

  it("tells an app what the campaign currently wants from it", async () => {
    const { getConfig } = await setup({
      features: {
        kanban: true,
        folios: true,
        petitions: true,
        chapters: true,
        sigils: true,
        beacon: true,
        vitals: false,
        blights: true,
      },
    });

    const res = await getConfig();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toEqual({ views: true, errors: true, vitals: false });
    expect(body.petitionUrl).toMatch(/\/c\/\d+\/request$/);
  });

  it("refuses to describe itself to an unknown token", async () => {
    const { getConfig } = await setup();

    const res = await getConfig("sg_nope");
    expect(res.status).toBe(401);
  });
});
