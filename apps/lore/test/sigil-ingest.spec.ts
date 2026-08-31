import { SIGIL_INGEST_PATH } from "@alepha/lore/sigil";
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
import { LoreAnalytics } from "../src/api/entities/loreAnalytics.ts";
import { projects } from "../src/api/entities/projects.ts";
import { sigilErrorGroups } from "../src/api/entities/sigilErrorGroups.ts";
import { sigils } from "../src/api/entities/sigils.ts";
import { sigilUniquesDaily } from "../src/api/entities/sigilUniquesDaily.ts";
import { LoreApi } from "../src/api/index.ts";
import { BlightRuleService } from "../src/api/services/BlightRuleService.ts";
import { SigilIngestService } from "../src/api/services/SigilIngestService.ts";
import { SigilTokenService } from "../src/api/services/SigilTokenService.ts";

class Probe {
  projects = $repository(projects);
  sigils = $repository(sigils);
  uniques = $repository(sigilUniquesDaily);
  errorGroups = $repository(sigilErrorGroups);
  blights = $repository(blights);
}

/**
 * Views and vitals, read back through the `$analytics()` datasets they are
 * now the only write for — see `SigilIngestService.absorbViews`'s doc.
 *
 * `groupBy` names every dimension the legacy tables carried as columns, so
 * these come back as close to "one row per hit-shape" as the dataset allows
 * — `readViews` mirrors `sigilViewsHourly`'s old grain exactly (one row per
 * `(hour, path, country)`); `readVitals` cannot: a bucket is a dimension on
 * the dataset rather than one of seven columns on one row, so a metric/path
 * with two populated buckets comes back as two rows, not one row with two
 * non-zero columns.
 */
const readReferrers = async (analytics: LoreAnalytics, sigilId: string) => {
  const result = await analytics.views.query({
    since: "2000-01-01",
    where: { sigilId: { inArray: [sigilId] } },
    groupBy: ["referrer"],
    select: { count: "sum" },
  });
  return (result.rows as unknown as Array<{ referrer: string; count: number }>)
    .slice()
    .sort((a, b) => a.referrer.localeCompare(b.referrer));
};

const readMeasures = async (analytics: LoreAnalytics, sigilId: string) => {
  const result = await analytics.views.query({
    since: "2000-01-01",
    where: { sigilId: { inArray: [sigilId] } },
    select: { count: "sum", engaged: "sum", entries: "sum" },
  });
  const row = result.rows[0] as any;
  return {
    count: Number(row?.count ?? 0),
    engaged: Number(row?.engaged ?? 0),
    entries: Number(row?.entries ?? 0),
  };
};

const readBy = async (
  analytics: LoreAnalytics,
  sigilId: string,
  dimension: "campaign" | "device" | "traffic",
) => {
  const result = await analytics.views.query({
    since: "2000-01-01",
    where: { sigilId: { inArray: [sigilId] } },
    groupBy: [dimension],
    select: { count: "sum" },
  });
  return (result.rows as any[])
    .map((r) => ({ value: String(r[dimension]), count: Number(r.count) }))
    .sort((a, b) => a.value.localeCompare(b.value));
};

const readViews = async (analytics: LoreAnalytics, sigilId: string) => {
  const result = await analytics.views.query({
    since: "2000-01-01",
    where: { sigilId: { inArray: [sigilId] } },
    groupBy: ["hour", "path", "country"],
    select: { count: "sum" },
  });
  return result.rows as unknown as Array<{
    hour: string;
    path: string;
    country: string;
    count: number;
  }>;
};

const readVitals = async (analytics: LoreAnalytics, sigilId: string) => {
  const result = await analytics.vitals.query({
    since: "2000-01-01",
    where: { sigilId: { inArray: [sigilId] } },
    groupBy: ["hour", "metric", "path", "bucket"],
    select: { samples: "sum" },
  });
  return result.rows as unknown as Array<{
    hour: string;
    metric: string;
    path: string;
    bucket: number;
    samples: number;
  }>;
};

/**
 * Every capability switched on, which is what most tests here want as a
 * baseline so their subject is the one thing they vary.
 *
 * The sigil toggles are absent from `defaultProjectFeatures` on purpose —
 * adding a key there changes the `projects` column DEFAULT, which on D1 means
 * a table rebuild that cascade-wipes production. So a project created without
 * an explicit `features` accepts nothing, and a test that forgot this would
 * pass while asserting on empty tables.
 */
const allOn = {
  kanban: true,
  folios: true,
  feedback: true,
  // The Releases module. Persisted key kept pre-rename - see projects.ts.
  milestones: true,
  sigils: true,
  blights: true,
  beacon: true,
  vitals: true,
};

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
  const analytics = alepha.inject(LoreAnalytics);
  const tokens = alepha.inject(SigilTokenService);
  const server = alepha.inject(ServerProvider);
  const users = alepha.inject(UserService);
  const service = alepha.inject(SigilIngestService);
  await alepha.start();

  // A real user row: `blight_ignore_rules.createdBy` carries a foreign key to
  // it, so a made-up id fails the constraint rather than the assertion.
  const owner = await users.createUser({ username: "owner" });

  const project = await probe.projects.create({
    title: "Test",
    // Written explicitly because this fixture bypasses `createProject`, which
    // is what normally derives it. Every production row has one (the backfill
    // filled the rest), and `configFor` builds `feedbackUrl` from it — so a
    // slug-less fixture would test a shape that cannot occur.
    slug: "test",
    createdBy: owner.id,
    features: over.features ?? allOn,
  } as any);

  const minted = await tokens.mint(project.id);
  const sigil = await probe.sigils.create({
    projectId: project.id,
    name: "demo",
    tokenHash: minted.hash,
    tokenPrefix: minted.prefix,
    kinds: over.kinds ?? ["beacon", "vitals", "blights", "feedback"],
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

  return {
    alepha,
    probe,
    analytics,
    owner,
    project,
    sigil,
    service,
    token: minted.token,
    post,
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
    const { analytics, sigil, post } = await setup();

    for (let i = 0; i < 5; i++) {
      const res = await post({ views: [{ path: "/home" }] });
      expect(res.status).toBe(204);
    }

    const rows = await readViews(analytics, sigil.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(5);
  });

  it("stores the referrer host the browser reported", async () => {
    const { analytics, sigil, post } = await setup();

    const res = await post({
      views: [{ path: "/", referrer: "news.ycombinator.com" }],
    });
    expect(res.status).toBe(204);

    expect(await readReferrers(analytics, sigil.id)).toEqual([
      { referrer: "news.ycombinator.com", count: 1 },
    ]);
  });

  it("folds a view with no referrer into `direct`", async () => {
    const { analytics, sigil, post } = await setup();

    // What every client-side navigation looks like, and what an older client
    // predating the field sends for a landing view too.
    const res = await post({ views: [{ path: "/" }] });
    expect(res.status).toBe(204);

    expect(await readReferrers(analytics, sigil.id)).toEqual([
      { referrer: "direct", count: 1 },
    ]);
  });

  it("folds a value that is not a bare host into `direct`", async () => {
    const { analytics, sigil, post } = await setup();

    // The envelope is accepted from anyone holding the token, so the sink
    // cannot assume the browser helper produced this. A half-parsed URL in a
    // leaderboard reads as data; `direct` reads as unknown.
    const res = await post({
      views: [
        { path: "/", referrer: "https://evil.example/path?token=abc" },
        { path: "/", referrer: "has spaces" },
      ],
    });
    expect(res.status).toBe(204);

    expect(await readReferrers(analytics, sigil.id)).toEqual([
      { referrer: "direct", count: 2 },
    ]);
  });

  it("keeps two different referrers in two buckets", async () => {
    const { analytics, sigil, post } = await setup();

    const res = await post({
      views: [
        { path: "/", referrer: "news.ycombinator.com" },
        { path: "/", referrer: "news.ycombinator.com" },
        { path: "/", referrer: "www.google.com" },
        { path: "/" },
      ],
    });
    expect(res.status).toBe(204);

    expect(await readReferrers(analytics, sigil.id)).toEqual([
      { referrer: "direct", count: 1 },
      { referrer: "news.ycombinator.com", count: 2 },
      { referrer: "www.google.com", count: 1 },
    ]);
  });

  it("counts a page load as an entry and a navigation as only a view", async () => {
    const { analytics, sigil, post } = await setup();

    const res = await post({
      views: [
        { path: "/", entry: true },
        { path: "/docs" },
        { path: "/docs/guides" },
      ],
    });
    expect(res.status).toBe(204);

    // One arrival, three pages. `entries` is what a landing-page report and a
    // bounce rate are computed from; `count` cannot answer either.
    expect(await readMeasures(analytics, sigil.id)).toEqual({
      count: 3,
      entries: 1,
      engaged: 0,
    });
  });

  it("records an engagement without inflating the view count", async () => {
    const { analytics, sigil, post } = await setup();

    const res = await post({
      views: [{ path: "/", entry: true }],
      engagements: [{ path: "/" }],
    });
    expect(res.status).toBe(204);

    expect(await readMeasures(analytics, sigil.id)).toEqual({
      count: 1,
      entries: 1,
      engaged: 1,
    });
  });

  it("accepts an engagement arriving in a later batch than its view", async () => {
    const { analytics, sigil, post } = await setup();

    // The real sequence: the view flushes at LCP, the engagement lands when
    // the visitor finally scrolls. Analytics Engine is append-only, so these
    // are two rows whose measures sum.
    expect((await post({ views: [{ path: "/", entry: true }] })).status).toBe(
      204,
    );
    expect((await post({ engagements: [{ path: "/" }] })).status).toBe(204);

    expect(await readMeasures(analytics, sigil.id)).toEqual({
      count: 1,
      entries: 1,
      engaged: 1,
    });
  });

  it("ignores engagements when the sigil cannot report views", async () => {
    const { analytics, sigil, post } = await setup({ kinds: ["blights"] });

    const res = await post({ engagements: [{ path: "/" }] });
    expect(res.status).toBe(204);

    expect(await readMeasures(analytics, sigil.id)).toEqual({
      count: 0,
      entries: 0,
      engaged: 0,
    });
  });

  it("stores the campaign tag, and `none` for an untagged view", async () => {
    const { analytics, sigil, post } = await setup();

    const res = await post({
      views: [{ path: "/", entry: true, campaign: "hn" }, { path: "/docs" }],
    });
    expect(res.status).toBe(204);

    expect(await readBy(analytics, sigil.id, "campaign")).toEqual([
      { value: "hn", count: 1 },
      { value: "none", count: 1 },
    ]);
  });

  it("folds a campaign that is not a plain slug into `none`", async () => {
    const { analytics, sigil, post } = await setup();

    // The envelope is accepted from any token holder, so an unbounded or
    // structured value must not be allowed to mint dimension rows.
    const res = await post({
      views: [{ path: "/", entry: true, campaign: "<script>/../x" }],
    });
    expect(res.status).toBe(204);

    expect(await readBy(analytics, sigil.id, "campaign")).toEqual([
      { value: "none", count: 1 },
    ]);
  });

  it("stores the device the proxy stamped, defaulting to desktop", async () => {
    const { analytics, sigil, post } = await setup();

    expect(
      (await post({ views: [{ path: "/" }], device: "mobile" })).status,
    ).toBe(204);
    // An older app's proxy sends no device at all.
    expect((await post({ views: [{ path: "/about" }] })).status).toBe(204);

    expect(await readBy(analytics, sigil.id, "device")).toEqual([
      { value: "desktop", count: 1 },
      { value: "mobile", count: 1 },
    ]);
  });

  it("stores the traffic kind the proxy stamped, defaulting to human", async () => {
    const { analytics, sigil, post } = await setup();

    expect(
      (await post({ views: [{ path: "/" }], traffic: "bot" })).status,
    ).toBe(204);
    expect(
      (await post({ views: [{ path: "/docs" }], traffic: "human" })).status,
    ).toBe(204);
    // An app whose proxy predates the stamp sends nothing. Counting its
    // readers as crawlers is the one direction this may not be wrong in, so
    // silence reads as a person.
    expect((await post({ views: [{ path: "/about" }] })).status).toBe(204);

    expect(await readBy(analytics, sigil.id, "traffic")).toEqual([
      { value: "bot", count: 1 },
      { value: "human", count: 2 },
    ]);
  });

  it("stamps the traffic kind on the visitor row as well as the view", async () => {
    const { probe, sigil, post } = await setup();

    // Same stamp, second destination. The views dataset and
    // `sigil_uniques_daily` are written by two different calls in
    // `absorbViews`, so a kind that reaches one and not the other is exactly
    // the failure that leaves the headline unfiltered while everything below
    // it moves.
    expect(
      (await post({ views: [{ path: "/" }], traffic: "bot", visitor: "v-bot" }))
        .status,
    ).toBe(204);
    expect(
      (
        await post({
          views: [{ path: "/" }],
          traffic: "human",
          visitor: "v-human",
        })
      ).status,
    ).toBe(204);

    const rows = await probe.uniques.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    const byHash = new Map(rows.map((r) => [r.visitorHash, r.traffic]));
    expect(byHash.get("v-bot")).toBe("bot");
    expect(byHash.get("v-human")).toBe("human");
  });

  it("refuses an unknown token", async () => {
    const { post } = await setup();

    const res = await post({ views: [{ path: "/" }] }, "sg_nope");
    expect(res.status).toBe(401);
  });

  it("ignores a kind the sigil does not carry", async () => {
    const { analytics, sigil, post } = await setup({ kinds: ["blights"] });

    const res = await post({ views: [{ path: "/home" }] });
    expect(res.status).toBe(204);

    const rows = await readViews(analytics, sigil.id);
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
    const { analytics, sigil, post } = await setup({
      kinds: ["beacon", "blights"],
    });

    const res = await post({
      vitals: [{ path: "/home", metric: "lcp", value: 900 }],
    });
    expect(res.status).toBe(204);

    expect(await readVitals(analytics, sigil.id)).toHaveLength(0);
  });

  it("refuses errors from a sigil without the blights kind", async () => {
    const { probe, project, sigil, post } = await setup({
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
        where: { projectId: { eq: project.id } },
      }),
    ).toHaveLength(0);
  });

  /*
    Blights, Beacon and Vitals are the sigil's own decision now, gated only by
    the project's `sigils` master switch — not by the three project-level
    flags those trackers used to share. `SigilController.updateSigil` is the
    per-app lever; the project flags are `@deprecated` and read by nothing.

    One test per tracker, each with the project flag explicitly off, so the
    only thing being proven is that it no longer has any effect.
  */
  it("writes views regardless of the retired Beacon project flag", async () => {
    const { analytics, probe, sigil, post } = await setup({
      features: { ...allOn, beacon: false },
    });

    const res = await post({
      views: [{ path: "/home" }],
      visitor: "v1",
      country: "FR",
    });
    expect(res.status).toBe(204);

    expect(sigil.kinds).toContain("beacon");
    expect(await readViews(analytics, sigil.id)).toHaveLength(1);
    // The daily visitor hash is a view-side write too, and it is the one that
    // is personal data — it follows the same gate.
    expect(
      await probe.uniques.findMany({ where: { sigilId: { eq: sigil.id } } }),
    ).toHaveLength(1);
  });

  it("writes vitals regardless of the retired Vitals project flag", async () => {
    const { analytics, sigil, post } = await setup({
      features: { ...allOn, vitals: false },
    });

    const res = await post({
      vitals: [{ path: "/home", metric: "lcp", value: 900 }],
    });
    expect(res.status).toBe(204);

    expect(sigil.kinds).toContain("vitals");
    expect(await readVitals(analytics, sigil.id)).toHaveLength(1);
  });

  it("writes errors regardless of the retired Blights project flag", async () => {
    const { probe, project, sigil, post } = await setup({
      features: { ...allOn, blights: false },
    });

    const res = await post({ errors: [anError()] });
    expect(res.status).toBe(204);

    expect(sigil.kinds).toContain("blights");
    expect(
      await probe.errorGroups.findMany({
        where: { sigilId: { eq: sigil.id } },
      }),
    ).toHaveLength(1);
    expect(
      await probe.blights.findMany({
        where: { projectId: { eq: project.id } },
      }),
    ).toHaveLength(1);
  });

  it("writes nothing at all when the sigils master switch is off", async () => {
    const { analytics, probe, project, sigil, post } = await setup({
      features: { ...allOn, sigils: false },
    });

    const res = await post({
      views: [{ path: "/home" }],
      vitals: [{ path: "/home", metric: "lcp", value: 900 }],
      errors: [anError()],
      visitor: "v1",
    });
    expect(res.status).toBe(204);

    expect(await readViews(analytics, sigil.id)).toHaveLength(0);
    expect(await readVitals(analytics, sigil.id)).toHaveLength(0);
    expect(
      await probe.blights.findMany({
        where: { projectId: { eq: project.id } },
      }),
    ).toHaveLength(0);
    // The daily visitor hash is a view-side write too, and it is the one
    // that is personal data: it must not survive the master switch either.
    expect(
      await probe.uniques.findMany({ where: { sigilId: { eq: sigil.id } } }),
    ).toHaveLength(0);
  });

  it("keeps only the kinds the sigil allows", async () => {
    // `gatesFor` used to be read twice — once to advertise via
    // `/sigils/config`, once to gate the write — and the pair had to agree.
    // The advertisement is gone: an app declares what it sends in its own
    // `SIGIL_CONFIG`, and this half decides what is kept. Vitals is withheld
    // via the sigil's own kinds.
    const { analytics, sigil, post } = await setup({
      kinds: ["beacon", "blights", "feedback"],
    });

    await post({
      views: [{ path: "/home" }],
      vitals: [{ path: "/home", metric: "lcp", value: 900 }],
    });

    expect(await readViews(analytics, sigil.id)).toHaveLength(1);
    expect(await readVitals(analytics, sigil.id)).toHaveLength(0);
  });

  it("survives a proxy that stamps an empty country", async () => {
    const { analytics, sigil, post } = await setup();

    // `country` is `z.string().max(8).optional()`, so `""` is valid on the
    // wire. `absorbViews` normalises it with `||`, not `??` — an empty
    // string is falsy but not `undefined`, so `?? "ZZ"` would let it through
    // unnormalised.
    const res = await post({ views: [{ path: "/home" }], country: "" });
    expect(res.status).toBe(204);

    const rows = await readViews(analytics, sigil.id);
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

  /**
   * The sink half of the per-stamp batching fix (`SigilSinkProvider`).
   *
   * A reporter used to fold a whole flush window into one envelope carrying
   * one stamp, so several visitors arrived as one. The sink already attributes
   * per envelope, and this pins that: two envelopes, two visitors, two
   * countries, and neither borrowing the other's.
   */
  it("attributes each envelope to its own visitor and country", async () => {
    const { analytics, probe, sigil, post } = await setup();

    await post({ views: [{ path: "/a" }], visitor: "alice", country: "FR" });
    await post({ views: [{ path: "/b" }], visitor: "bob", country: "JP" });

    const uniques = await probe.uniques.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(uniques).toHaveLength(2);

    const rows = await readViews(analytics, sigil.id);
    expect(rows.map((r) => `${r.path}:${r.country}`).sort()).toEqual([
      "/a:FR",
      "/b:JP",
    ]);
  });

  it("strips the query string so storage stays bounded by page count", async () => {
    const { analytics, sigil, post } = await setup();

    await post({ views: [{ path: "/search?q=a" }] });
    await post({ views: [{ path: "/search?q=b" }] });

    const rows = await readViews(analytics, sigil.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe("/search");
    expect(rows[0].count).toBe(2);
  });

  it("keeps vitals as bucket counts rather than samples", async () => {
    const { analytics, sigil, post } = await setup();

    await post({ vitals: [{ path: "/home", metric: "lcp", value: 900 }] });
    await post({ vitals: [{ path: "/home", metric: "lcp", value: 950 }] });
    await post({ vitals: [{ path: "/home", metric: "lcp", value: 5000 }] });

    const rows = await readVitals(analytics, sigil.id);
    // 900 and 950 both land in the first bucket (<= 1000); 5000 in the fifth.
    // Accumulated across three separate batches, so this is also the guard
    // that the increment reads the stored value rather than overwriting it.
    // Unlike the deleted legacy table, an empty bucket has no row at all — a
    // bucket is a dataset dimension now, not one of seven columns on a
    // single row — so only the two populated buckets come back.
    const byBucket = new Map(rows.map((row) => [row.bucket, row.samples]));
    expect([...byBucket.keys()].sort((a, b) => a - b)).toEqual([0, 5]);
    expect(byBucket.get(0)).toBe(2);
    expect(byBucket.get(5)).toBe(1);
  });

  /**
   * The lost-update race the JSON column made unavoidable: with a
   * read-modify-write, two samples for the same `(hour, metric, path)` in
   * flight together both read the same "before" and one overwrites the other.
   * A column per bucket made it `b0 = b0 + excluded.b0` in one statement on
   * the legacy table; the `$analytics()` dataset that replaced it upserts the
   * same way, keyed on `(hour, sigilId, metric, path, bucket)` — concurrency
   * still costs nothing.
   */
  it("does not lose concurrent samples for the same bucket", async () => {
    const { analytics, sigil, post } = await setup();

    await Promise.all(
      Array.from({ length: 8 }, () =>
        post({ vitals: [{ path: "/race", metric: "lcp", value: 900 }] }),
      ),
    );

    const rows = (await readVitals(analytics, sigil.id)).filter(
      (row) => row.path === "/race",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].samples).toBe(8);
  });

  /**
   * One batch, many samples in the same bucket. The fold has to add them up:
   * a `+ 1` literal in the conflict clause would record one, and duplicate
   * conflict targets in a single statement are rejected outright by Postgres.
   */
  it("adds up several samples for one bucket inside a single batch", async () => {
    const { analytics, sigil, post } = await setup();

    await post({
      vitals: [
        { path: "/batch", metric: "lcp", value: 900 },
        { path: "/batch", metric: "lcp", value: 950 },
        { path: "/batch", metric: "lcp", value: 999 },
        { path: "/batch", metric: "lcp", value: 5000 },
      ],
    });

    const rows = (await readVitals(analytics, sigil.id)).filter(
      (row) => row.path === "/batch",
    );
    const byBucket = new Map(rows.map((row) => [row.bucket, row.samples]));
    expect(byBucket.get(0)).toBe(3);
    expect(byBucket.get(5)).toBe(1);
  });

  /**
   * The same fold on the views side: several views of one path in a batch
   * must add up rather than count as one.
   */
  it("adds up repeated views of one path inside a single batch", async () => {
    const { analytics, sigil, post } = await setup();

    await post({
      views: [
        { path: "/dup" },
        { path: "/dup" },
        { path: "/dup" },
        { path: "/other" },
      ],
    });

    const rows = await readViews(analytics, sigil.id);
    const byPath = new Map(rows.map((row) => [row.path, row.count]));
    expect(byPath.get("/dup")).toBe(3);
    expect(byPath.get("/other")).toBe(1);
  });

  it("files an error into both the per-sigil group and the project inbox", async () => {
    const { probe, project, sigil, post } = await setup();

    await post({ errors: [anError({ count: 3 })] });
    await post({ errors: [anError({ count: 4 })] });

    // The per-app truth: how bad is it *here*.
    const groups = await probe.errorGroups.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(7);

    // The project-wide editorial decision: one row, one status.
    const inbox = await probe.blights.findMany({
      where: { projectId: { eq: project.id } },
    });
    expect(inbox).toHaveLength(1);
    expect(inbox[0].count).toBe(7);
    expect(inbox[0].sigilId).toBe(sigil.id);
    expect(inbox[0].status).toBe("open");
  });

  it("adds up two reports of one fingerprint inside a single batch", async () => {
    const { probe, project, sigil, post } = await setup();

    // A fingerprint is hashed from `name` + `stack`, so two reports that differ
    // only in `message` share one. That is ordinary input, and it is exactly
    // the case `upsertMany` refuses to be handed twice in one statement —
    // Postgres throws, SQLite silently applies them in sequence — so the batch
    // has to be folded before it is written.
    await post({
      errors: [
        anError({ count: 2, message: "first sighting" }),
        anError({ count: 3, message: "second sighting" }),
      ],
    });

    const groups = await probe.errorGroups.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(5);
    // The first occurrence supplies the descriptive fields — the same
    // precedence a conflicting `set` gives an already-stored row, so a
    // fingerprint behaves the same whether its sibling arrived in this
    // envelope or an hour ago in another.
    expect(groups[0].message).toBe("first sighting");

    const inbox = await probe.blights.findMany({
      where: { projectId: { eq: project.id } },
    });
    expect(inbox).toHaveLength(1);
    expect(inbox[0].count).toBe(5);
    expect(inbox[0].message).toBe("first sighting");
  });

  it("gives each fingerprint in a batch its own increment", async () => {
    const { probe, sigil, post } = await setup();

    const other = {
      name: "RangeError",
      stack: "RangeError: nope\n    at pay (app.iHryQ0pA.js:99:1)",
    };

    // File both first, so the second batch takes the *conflict* path — where
    // one `set` clause serves every row in the statement. A captured count
    // there applies one row's increment to all of them, which is why the
    // increment has to read `excluded`. Deliberately lopsided counts: equal
    // ones would pass under either reading.
    await post({
      errors: [anError({ count: 1 }), anError({ ...other, count: 1 })],
    });
    await post({
      errors: [anError({ count: 2 }), anError({ ...other, count: 40 })],
    });

    const groups = await probe.errorGroups.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(groups.map((g) => g.count).sort((a, b) => a - b)).toEqual([3, 41]);
  });

  it("keeps two apps apart in the groups and together in the inbox", async () => {
    const { alepha, probe, project, post } = await setup();

    const tokens = alepha.inject(SigilTokenService);
    const staging = await tokens.mint(project.id);
    const other = await probe.sigils.create({
      projectId: project.id,
      name: "demo-staging",
      tokenHash: staging.hash,
      tokenPrefix: staging.prefix,
      kinds: ["blights"],
    });

    await post({ errors: [anError({ count: 2 })] });
    await post({ errors: [anError({ count: 5 })] }, staging.token);

    // Two budgets, because two apps.
    const groups = await probe.errorGroups.findMany({});
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.count).sort((a, b) => a - b)).toEqual([2, 5]);

    // One triage decision, because one bug.
    const inbox = await probe.blights.findMany({
      where: { projectId: { eq: project.id } },
    });
    expect(inbox).toHaveLength(1);
    expect(inbox[0].count).toBe(7);
    // Last reporter wins, which is what the inbox filter means by "sigil".
    expect(inbox[0].sigilId).toBe(other.id);
  });

  it("keeps a triage decision when the same bug is reported again", async () => {
    const { probe, project, post } = await setup();

    await post({ errors: [anError({ count: 2 })] });
    const [filed] = await probe.blights.findMany({
      where: { projectId: { eq: project.id } },
    });
    await probe.blights.updateById(filed.id, { status: "resolved" });

    // The load-bearing half of the "one row per project" ruling: the whole
    // reason `blights` is keyed by project rather than by sigil is that a
    // triage decision must not fork. If `status` ever joins the upsert's `set`
    // clause, resolving a bug becomes a decision the next batch undoes.
    await post({ errors: [anError({ count: 3 })] });

    const rows = await probe.blights.findMany({
      where: { projectId: { eq: project.id } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("resolved");
    // Still counted, though — the bug is still happening, it is just triaged.
    expect(rows[0].count).toBe(5);
  });

  it("drops a muted message before it reaches either table", async () => {
    const { alepha, probe, owner, project, sigil, post } = await setup();

    await alepha
      .inject(BlightRuleService)
      .create(project.id, "ResizeObserver", owner.id);

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
        where: { projectId: { eq: project.id } },
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

  describe("reported config", () => {
    const reported = {
      trackers: { views: true, errors: true, vitals: false },
      feedback: true,
      feedbackButton: "hidden",
      feedbackButtonExcludedPaths: ["/request"],
      reportOutsideProduction: false,
    };

    it("stores what the app said it is running, with its own timestamp", async () => {
      const { probe, sigil, post } = await setup();

      const res = await post({ views: [{ path: "/home" }], config: reported });
      expect(res.status).toBe(204);

      const after = await probe.sigils.findOne({
        where: { id: { eq: sigil.id } },
      });
      expect(after?.reportedConfig).toEqual(reported);
      expect(after?.reportedConfigAt).toBeTruthy();
    });

    /**
     * An older client sends nothing on every batch. Letting that erase what a
     * newer deploy reported would make the field flicker between known and
     * unknown depending on which process flushed last.
     */
    it("leaves a stored config alone when a batch carries none", async () => {
      const { probe, sigil, post } = await setup();

      await post({ views: [{ path: "/a" }], config: reported });
      await post({ views: [{ path: "/b" }] });

      const after = await probe.sigils.findOne({
        where: { id: { eq: sigil.id } },
      });
      expect(after?.reportedConfig).toEqual(reported);
    });

    it("reads as unknown for an app that has never reported one", async () => {
      const { probe, sigil, post } = await setup();

      await post({ views: [{ path: "/home" }] });

      const after = await probe.sigils.findOne({
        where: { id: { eq: sigil.id } },
      });
      // Absent, not an all-false object: "has not told us" and "off" are
      // different answers and the UI renders them differently.
      expect(after?.reportedConfig).toBeUndefined();
      expect(after?.reportedConfigAt).toBeUndefined();
    });

    /**
     * The whole point of storing it: what the app claims and what this sink
     * accepts, side by side, so a disagreement is visible. It must never
     * become an input to either.
     */
    it("never feeds the gates and never overwrites kinds", async () => {
      const { probe, service, sigil, post } = await setup({
        kinds: ["beacon"],
      });

      // The app claims every tracker is on. The sigil carries `beacon` alone.
      await post({
        vitals: [{ path: "/", metric: "lcp", value: 1200 }],
        errors: [anError()],
        config: {
          ...reported,
          trackers: { views: true, errors: true, vitals: true },
        },
      });

      const after = await probe.sigils.findOne({
        where: { id: { eq: sigil.id } },
      });
      expect(after?.kinds).toEqual(["beacon"]);

      const gates = await service.gatesFor(after ?? sigil);
      expect(gates.vitals).toBe(false);
      expect(gates.errors).toBe(false);
      // And the claim was stored anyway, which is what makes the disagreement
      // renderable rather than merely refused.
      expect(after?.reportedConfig?.trackers).toEqual({
        views: true,
        errors: true,
        vitals: true,
      });
    });

    it("refuses an unshaped config at the door, like every other field", async () => {
      const { probe, sigil, post } = await setup();

      const res = await post({
        views: [{ path: "/home" }],
        config: { trackers: { views: "yes" } },
      });
      // The ingest body is validated as a whole, and this field is no
      // exception: `errors[].origin` refuses an unknown value the same way.
      expect(res.status).toBe(400);

      const after = await probe.sigils.findOne({
        where: { id: { eq: sigil.id } },
      });
      expect(after?.reportedConfig).toBeUndefined();
      expect(after?.lastSeenAt).toBeUndefined();
    });

    /**
     * The forward-compatibility half of the rule above, and the reason a
     * strict schema here is not a trap: a newer client that adds a field does
     * not lose its telemetry to an older sink, because zod strips what it does
     * not know rather than refusing it. Only a CHANGED type would break, which
     * is a breaking change to the wire either way.
     */
    it("strips a field a newer client added rather than refusing the batch", async () => {
      const { probe, sigil, post } = await setup();

      const res = await post({
        views: [{ path: "/home" }],
        config: { ...reported, sampling: 0.25 },
      });
      expect(res.status).toBe(204);

      const after = await probe.sigils.findOne({
        where: { id: { eq: sigil.id } },
      });
      expect(after?.reportedConfig).toEqual(reported);
    });
  });

  it("gates blights, beacon and vitals on the sigil's kinds alone", async () => {
    // The project carries none of the retired flags — under the old rule that
    // meant every capability was off regardless of what the sigil carried.
    const { service, sigil } = await setup({
      features: {
        kanban: true,
        folios: true,
        feedback: true,
        milestones: true,
        sigils: true,
      },
    });

    const gates = await service.gatesFor({
      ...sigil,
      kinds: ["blights", "beacon", "vitals"],
    });

    expect(gates.errors).toBe(true);
    expect(gates.views).toBe(true);
    expect(gates.vitals).toBe(true);
  });

  it("still requires the project's feedback flag", async () => {
    const { service, sigil } = await setup({
      features: { ...allOn, feedback: false },
    });

    const gates = await service.gatesFor({ ...sigil, kinds: ["feedback"] });

    // `features.feedback` also gates the first-party /request form, which
    // works with no app enrolled at all — so it stays a project-level
    // decision.
    expect(gates.feedback).toBe(false);
  });

  it("still requires the sigils master switch", async () => {
    const { probe, project, service, sigil } = await setup();

    await probe.projects.updateById(project.id, {
      features: { ...allOn, sigils: false },
    });

    const gates = await service.gatesFor({
      ...sigil,
      kinds: ["blights", "beacon", "vitals", "feedback"],
    });

    expect(gates.errors).toBe(false);
    expect(gates.views).toBe(false);
    expect(gates.vitals).toBe(false);
    // Feedback too: `features.feedback` is still on here, so this asserts the
    // master switch and not the module flag standing in for it.
    expect(gates.feedback).toBe(false);
  });
});
