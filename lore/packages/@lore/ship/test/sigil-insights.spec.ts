import { Alepha } from "alepha";
import {
  AnalyticsProvider,
  type AnalyticsRow,
  EventLogProvider,
} from "alepha/api/analytics";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import {
  $repository,
  AlephaOrm,
  DatabaseProvider,
  NodeSqliteProvider,
} from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import {
  DeployAnalytics,
  LoreShipApi,
  type SigilInsightsQuery,
  SigilInsightsService,
} from "../src/api/index.ts";
import { sigilSessions, sigilVisits, sigils } from "../src/schemas/index.ts";
import { createTestProject, DeployTestEntities } from "../src/testing/index.ts";

/**
 * SQLite refusing a statement that binds more than 100 values, as D1 does.
 */
class D1CeilingProvider extends NodeSqliteProvider {
  public override readonly maxBoundParameters = 100;

  protected override initDrizzle(): void {
    const database = this.sqlite as unknown as {
      prepare: (text: string) => unknown;
    };
    const prepare = database.prepare.bind(database);
    database.prepare = (text: string) => {
      const bound = text.split("?").length - 1;
      if (bound > this.maxBoundParameters) {
        throw new Error(`too many SQL variables (${bound})`);
      }
      return prepare(text);
    };
    super.initDrizzle();
  }
}

class Repositories {
  sigils = $repository(sigils);
  sessions = $repository(sigilSessions);
  visits = $repository(sigilVisits);
}

const DAY = 86_400_000;
const MIN = 60_000;
/**
 * "Now" in every test: the log then reaches back to 2026-08-13.
 */
const NOW = "2026-11-10T12:00:00.000Z";

interface SeedView {
  path: string;
  minute: number;
}

const setup = async (options: { d1?: boolean } = {}) => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  if (options.d1) {
    alepha.with({ provide: DatabaseProvider, use: D1CeilingProvider });
  }
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreShipApi);
  alepha.inject(DeployTestEntities);
  const repos = alepha.inject(Repositories);
  const insights = alepha.inject(SigilInsightsService);
  const analytics = alepha.inject(DeployAnalytics);
  const dateTime = alepha.inject(DateTimeProvider);
  await alepha.start();
  dateTime.pause();
  await dateTime.travel(Date.parse(NOW) - dateTime.nowMillis());

  const project = await createTestProject(alepha, {
    capabilities: [{ key: "ship", options: { track: true } }],
  });
  let apps = 0;
  const app = async () =>
    (
      await repos.sigils.create({
        projectId: project.id,
        name: `app-${++apps}`,
        tokenHash: `hash-${apps}`,
        tokenPrefix: `sg_${apps}`,
        kinds: ["beacon"],
      })
    ).id;

  const logProvider = alepha.inject(EventLogProvider);
  const viewsProvider = alepha.inject(AnalyticsProvider);
  const logStart = insights.logStart();

  /**
   * One visit, written the way ingest writes it to all three stores: its
   * session and visit rows, one log row per view when inside the log, and
   * the `sigil_views` buckets (a referrer on the landing view only).
   */
  const visit = async (input: {
    sigilId: string;
    visitor: string;
    period?: string;
    start: string;
    views: SeedView[];
    referrer?: string;
    country?: string;
    engaged?: boolean;
  }) => {
    const start = Date.parse(input.start);
    const period = input.period ?? input.start.slice(0, 7);
    const existing = await repos.sessions.findMany({
      where: {
        sigilId: { eq: input.sigilId },
        period: { eq: period },
        visitorHash: { eq: input.visitor },
      },
    });
    const times = input.views.map((v) => start + v.minute * MIN);
    const first = new Date(Math.min(...times)).toISOString();
    const last = new Date(Math.max(...times)).toISOString();
    const sessionId =
      existing[0]?.id ??
      (
        await repos.sessions.create({
          id: crypto.randomUUID(),
          sigilId: input.sigilId,
          period,
          periodEndsAt: "2099-01-01T00:00:00.000Z",
          visitorHash: input.visitor,
          firstSeenAt: first,
          lastSeenAt: last,
        })
      ).id;
    const visitId = crypto.randomUUID();
    const referrer = input.referrer ?? "direct";
    const country = input.country ?? "FR";
    await repos.visits.create({
      id: visitId,
      sigilId: input.sigilId,
      sessionId,
      startedAt: first,
      lastSeenAt: last,
      views: input.views.length,
      engaged: !!input.engaged,
      entryPath: input.views[0].path,
      exitPath: input.views[input.views.length - 1].path,
      referrer,
      campaign: "none",
      country,
      device: "desktop",
      browser: "chrome",
      os: "macos",
      traffic: "human",
      auth: "anon",
    });
    if (start >= logStart) {
      await logProvider.append(
        analytics.pageviews.eventLog,
        input.views.map((view, index) => ({
          at: times[index],
          sigilId: input.sigilId,
          sessionId,
          visitId,
          path: view.path,
          country,
          device: "desktop",
          browser: "chrome",
          os: "macos",
          referrer,
          campaign: "none",
          traffic: "human",
          auth: "anon",
          network: null,
          views: 1,
          engaged: 0,
        })),
      );
    }
    await viewRows(
      input.sigilId,
      input.views.map((view, index) => ({
        at: times[index],
        path: view.path,
        referrer: index === 0 ? referrer : "direct",
        country,
        traffic: "human",
        entry: index === 0,
      })),
    );
  };

  /**
   * `sigil_views` rows, written to the provider directly so a bucket older
   * than the hot tier can be placed (`record()` would drop it).
   */
  const viewRows = async (
    sigilId: string,
    rows: Array<{
      at: number;
      path: string;
      referrer?: string;
      country?: string;
      traffic: string;
      entry?: boolean;
    }>,
  ) => {
    await viewsProvider.record(
      analytics.views.dataset,
      rows.map(
        (row) =>
          ({
            hour: new Date(row.at).toISOString().slice(0, 13),
            sigilId,
            path: row.path,
            country: row.country ?? "FR",
            referrer: row.referrer ?? "direct",
            campaign: "none",
            device: "desktop",
            traffic: row.traffic,
            browser: "chrome",
            os: "macos",
            auth: "anon",
            count: 1,
            engaged: 0,
            entries: row.entry ? 1 : 0,
          }) as unknown as AnalyticsRow,
      ),
    );
  };

  const query = (
    over: Partial<SigilInsightsQuery> & { sigilIds: string[] },
  ): SigilInsightsQuery => ({
    from: Date.parse("2026-11-01T00:00:00.000Z"),
    to: Date.parse("2026-11-10T00:00:00.000Z"),
    grain: "day",
    traffic: "humans",
    filters: {},
    ...over,
  });

  return { alepha, repos, insights, app, visit, viewRows, query, logStart };
};

describe("SigilInsightsService.read", () => {
  it("is exact against a seeded log: visitors, visits, views and the visit rates, with combined filters", async () => {
    const { insights, app, visit, query } = await setup();
    const a = await app();
    // v2 starts before the range, so the whole range counts visitors.
    await visit({
      sigilId: a,
      visitor: "v0",
      start: "2026-10-20T10:00:00.000Z",
      views: [{ path: "/", minute: 0 }],
    });
    await visit({
      sigilId: a,
      visitor: "v1",
      start: "2026-11-02T10:00:00.000Z",
      views: [
        { path: "/", minute: 0 },
        { path: "/a", minute: 3 },
      ],
      engaged: true,
    });
    await visit({
      sigilId: a,
      visitor: "v1",
      start: "2026-11-03T10:00:00.000Z",
      views: [{ path: "/a", minute: 0 }],
    });
    await visit({
      sigilId: a,
      visitor: "v2",
      start: "2026-11-03T11:00:00.000Z",
      views: [{ path: "/", minute: 0 }],
      country: "DE",
    });

    const all = await insights.read(query({ sigilIds: [a] }));
    expect(all.totals).toMatchObject({ visitors: 2, visits: 3, views: 4 });
    expect(all.totals.bounceRate).toBeCloseTo(2 / 3);
    expect(all.totals.engagedRate).toBeCloseTo(1 / 3);
    expect(all.totals.pagesPerVisit).toBeCloseTo(4 / 3);
    expect(all.totals.avgVisitSeconds).toBeCloseTo(60);

    const filtered = await insights.read(
      query({ sigilIds: [a], filters: { country: "FR", path: "/a" } }),
    );
    expect(filtered.totals).toMatchObject({ visitors: 1, visits: 2, views: 2 });
    // Bounce of the visits that ENTERED on /a: one, a bounce.
    expect(filtered.totals.bounceRate).toBe(1);

    const day3 = all.timeline.find((b) => b.bucket === "2026-11-03");
    expect(day3).toEqual({
      bucket: "2026-11-03",
      visitors: 2,
      visits: 2,
      views: 2,
    });
  });

  it("zero-fills hourly, daily, weekly and monthly buckets", async () => {
    const { insights, app, visit, query } = await setup();
    const a = await app();
    await visit({
      sigilId: a,
      visitor: "v1",
      start: "2026-11-03T10:00:00.000Z",
      views: [{ path: "/", minute: 0 }],
    });

    const hourly = await insights.read(
      query({
        sigilIds: [a],
        grain: "hour",
        from: Date.parse("2026-11-03T08:00:00.000Z"),
        to: Date.parse("2026-11-03T12:00:00.000Z"),
      }),
    );
    expect(hourly.timeline.map((b) => [b.bucket, b.views])).toEqual([
      ["2026-11-03T08", 0],
      ["2026-11-03T09", 0],
      ["2026-11-03T10", 1],
      ["2026-11-03T11", 0],
    ]);
    const daily = await insights.read(query({ sigilIds: [a] }));
    expect(daily.timeline).toHaveLength(9);
    const weekly = await insights.read(
      query({
        sigilIds: [a],
        grain: "week",
        from: Date.parse("2026-10-26T00:00:00.000Z"),
        to: Date.parse("2026-11-09T00:00:00.000Z"),
      }),
    );
    expect(weekly.timeline.map((b) => [b.bucket, b.views])).toEqual([
      ["2026-10-26", 0],
      ["2026-11-02", 1],
    ]);
    const monthly = await insights.read(
      query({
        sigilIds: [a],
        grain: "month",
        from: Date.parse("2026-09-01T00:00:00.000Z"),
        to: Date.parse("2026-11-10T00:00:00.000Z"),
      }),
    );
    expect(monthly.timeline.map((b) => [b.bucket, b.views])).toEqual([
      ["2026-09", 0],
      ["2026-10", 0],
      ["2026-11", 1],
    ]);
    await expect(
      insights.read(query({ sigilIds: [a], grain: "hour" })),
    ).rejects.toThrow(/7 days/);
    // Hours are kept for 30 days only.
    await expect(
      insights.read(
        query({
          sigilIds: [a],
          grain: "hour",
          from: Date.parse("2026-10-01T00:00:00.000Z"),
          to: Date.parse("2026-10-02T00:00:00.000Z"),
        }),
      ),
    ).rejects.toThrow(/30 days/);
    await expect(
      insights.read(
        query({
          sigilIds: [a],
          from: Date.parse("2023-01-01T00:00:00.000Z"),
        }),
      ),
    ).rejects.toThrow(/day buckets, more than 1000/);
  });

  it("leaves the visit rates null when the range has no visit", async () => {
    const { insights, app, visit, query } = await setup();
    const a = await app();
    await visit({
      sigilId: a,
      visitor: "v1",
      start: "2026-10-20T10:00:00.000Z",
      views: [{ path: "/", minute: 0 }],
    });
    const reading = await insights.read(query({ sigilIds: [a] }));
    expect(reading.totals.visits).toBe(0);
    expect(reading.totals.bounceRate).toBeNull();
    expect(reading.totals.engagedRate).toBeNull();
    expect(reading.totals.avgVisitSeconds).toBeNull();
    expect(reading.totals.pagesPerVisit).toBeNull();
  });

  it("splices a range crossing the 90 day line without counting a day or a visitor twice", async () => {
    const { insights, app, visit, query, logStart } = await setup();
    const a = await app();
    // One visitor on both sides of the line, in one monthly period.
    const before = new Date(logStart - 2 * DAY + 10 * 3_600_000).toISOString();
    const after = new Date(logStart + 2 * DAY + 10 * 3_600_000).toISOString();
    expect(before.slice(0, 7)).toBe(after.slice(0, 7));
    await visit({
      sigilId: a,
      visitor: "v1",
      start: before,
      views: [
        { path: "/", minute: 0 },
        { path: "/b", minute: 1 },
      ],
    });
    await visit({
      sigilId: a,
      visitor: "v1",
      start: after,
      views: [{ path: "/", minute: 0 }],
    });
    await visit({
      sigilId: a,
      visitor: "v2",
      start: after,
      views: [{ path: "/c", minute: 5 }],
    });

    const reading = await insights.read(
      query({
        sigilIds: [a],
        from: logStart - 10 * DAY,
        to: logStart + 10 * DAY,
      }),
    );
    expect(reading.totals).toMatchObject({ visitors: 2, visits: 3, views: 4 });
    const days = reading.timeline.filter((b) => b.views > 0);
    expect(days.map((b) => [b.bucket, b.views])).toEqual([
      [before.slice(0, 10), 2],
      [after.slice(0, 10), 2],
    ]);
    expect(reading.timeline.reduce((n, b) => n + b.views, 0)).toBe(4);
  });

  it("gives the same views per day under a referrer filter on both sides of the 90 day line", async () => {
    const { insights, app, visit, query, logStart } = await setup();
    const a = await app();
    for (const start of [logStart - 3 * DAY, logStart + 3 * DAY]) {
      // Three views in a visit from news.example: only the first carries
      // the referrer in `sigil_views`, every one does in the log and in
      // the visit.
      await visit({
        sigilId: a,
        visitor: `v${start}`,
        start: new Date(start + 9 * 3_600_000).toISOString(),
        referrer: "news.example",
        views: [
          { path: "/", minute: 0 },
          { path: "/a", minute: 1 },
          { path: "/b", minute: 2 },
        ],
      });
    }
    const reading = await insights.read(
      query({
        sigilIds: [a],
        from: logStart - 10 * DAY,
        to: logStart + 10 * DAY,
        filters: { referrer: "news.example" },
      }),
    );
    const days = reading.timeline
      .filter((b) => b.views > 0)
      .map((b) => b.views);
    expect(days).toEqual([3, 3]);
  });

  it("under a path filter older than the log, leaves visitors and visits null with visitorsFrom set, and bounce reads visits entered on it", async () => {
    const { insights, app, visit, query, logStart } = await setup();
    const a = await app();
    const old = new Date(logStart - 20 * DAY).toISOString();
    await visit({
      sigilId: a,
      visitor: "v1",
      start: old,
      views: [{ path: "/x", minute: 0 }],
    });
    await visit({
      sigilId: a,
      visitor: "v2",
      start: old,
      views: [
        { path: "/x", minute: 0 },
        { path: "/y", minute: 1 },
      ],
    });
    await visit({
      sigilId: a,
      visitor: "v3",
      start: old,
      views: [
        { path: "/y", minute: 0 },
        { path: "/x", minute: 1 },
      ],
    });

    const range = { from: logStart - 30 * DAY, to: logStart - 5 * DAY };
    const reading = await insights.read(
      query({ sigilIds: [a], ...range, filters: { path: "/x" } }),
    );
    expect(reading.totals.visitors).toBeNull();
    expect(reading.totals.visits).toBeNull();
    expect(reading.visitorsFrom).toBe(
      new Date(logStart).toISOString().slice(0, 10),
    );
    expect(reading.totals.views).toBe(3);
    // Two visits entered on /x, one bounced.
    expect(reading.totals.bounceRate).toBe(0.5);
  });

  it("sets visitorsSpanPeriods and visitorsSpanApps exactly when the visitor count is a sum", async () => {
    const { insights, app, visit, query } = await setup();
    const a = await app();
    const b = await app();
    await visit({
      sigilId: a,
      visitor: "v1",
      start: "2026-10-30T10:00:00.000Z",
      views: [{ path: "/", minute: 0 }],
    });
    await visit({
      sigilId: a,
      visitor: "v1",
      start: "2026-11-02T10:00:00.000Z",
      views: [{ path: "/", minute: 0 }],
    });
    await visit({
      sigilId: b,
      visitor: "v1",
      start: "2026-11-02T10:00:00.000Z",
      views: [{ path: "/", minute: 0 }],
    });

    const november = await insights.read(query({ sigilIds: [a] }));
    expect(november.visitorsSpanPeriods).toBe(false);
    expect(november.visitorsSpanApps).toBe(false);
    expect(november.totals.visitors).toBe(1);

    const crossing = await insights.read(
      query({ sigilIds: [a], from: Date.parse("2026-10-25T00:00:00.000Z") }),
    );
    expect(crossing.visitorsSpanPeriods).toBe(true);
    expect(crossing.totals.visitors).toBe(2);

    const both = await insights.read(query({ sigilIds: [a, b] }));
    expect(both.visitorsSpanApps).toBe(true);
    expect(both.totals.visitors).toBe(2);
  });

  it("reads bots from sigil_views alone with null visitors, and all as people plus bot views", async () => {
    const { insights, app, visit, viewRows, query } = await setup();
    const a = await app();
    await visit({
      sigilId: a,
      visitor: "v1",
      start: "2026-11-02T10:00:00.000Z",
      views: [
        { path: "/", minute: 0 },
        { path: "/a", minute: 1 },
      ],
    });
    await viewRows(a, [
      { at: Date.parse("2026-11-02T11:00:00.000Z"), path: "/", traffic: "bot" },
      {
        at: Date.parse("2026-11-03T11:00:00.000Z"),
        path: "/a",
        traffic: "bot",
      },
      {
        at: Date.parse("2026-11-03T12:00:00.000Z"),
        path: "/a",
        traffic: "bot",
      },
    ]);

    const bots = await insights.read(query({ sigilIds: [a], traffic: "bots" }));
    expect(bots.totals).toEqual({
      visitors: null,
      visits: null,
      views: 3,
      bounceRate: null,
      engagedRate: null,
      avgVisitSeconds: null,
      pagesPerVisit: null,
    });
    expect(bots.peopleOnly).toBe(false);

    const all = await insights.read(query({ sigilIds: [a], traffic: "all" }));
    expect(all.totals).toMatchObject({ visitors: 1, visits: 1, views: 5 });
    expect(all.peopleOnly).toBe(true);
    const humans = await insights.read(query({ sigilIds: [a] }));
    expect(humans.totals).toMatchObject({ visitors: 1, views: 2 });
  });

  it("answers views only before v2's first day", async () => {
    const { insights, app, viewRows, query } = await setup();
    const a = await app();
    await viewRows(a, [
      {
        at: Date.parse("2026-11-02T11:00:00.000Z"),
        path: "/",
        traffic: "human",
      },
    ]);
    const reading = await insights.read(query({ sigilIds: [a] }));
    expect(reading.totals.visitors).toBeNull();
    expect(reading.totals.views).toBe(1);
    expect(reading.timeline.every((b) => b.visitors === null)).toBe(true);
  });
});

describe("SigilInsightsService.leaderboard", () => {
  it("ranks every dimension by visitors and views, exit pages and networks included", async () => {
    const { insights, app, visit, query } = await setup();
    const a = await app();
    await visit({
      sigilId: a,
      visitor: "v0",
      start: "2026-10-20T10:00:00.000Z",
      views: [{ path: "/", minute: 0 }],
    });
    await visit({
      sigilId: a,
      visitor: "v1",
      start: "2026-11-02T10:00:00.000Z",
      views: [
        { path: "/", minute: 0 },
        { path: "/a", minute: 1 },
      ],
    });
    await visit({
      sigilId: a,
      visitor: "v2",
      start: "2026-11-03T10:00:00.000Z",
      views: [{ path: "/", minute: 0 }],
      country: "DE",
    });

    const pages = await insights.leaderboard(
      query({ sigilIds: [a] }),
      "path",
      10,
    );
    expect(pages.rows).toEqual([
      { value: "/", visitors: 2, views: 2 },
      { value: "/a", visitors: 1, views: 1 },
    ]);
    const exits = await insights.leaderboard(
      query({ sigilIds: [a] }),
      "exit",
      10,
    );
    // Tied on visitors, ranked by views.
    expect(exits.rows).toEqual([
      { value: "/a", visitors: 1, views: 2 },
      { value: "/", visitors: 1, views: 1 },
    ]);
    const countries = await insights.leaderboard(
      query({ sigilIds: [a], filters: { path: "/" } }),
      "country",
      10,
    );
    expect(countries.rows).toEqual([
      { value: "DE", visitors: 1, views: 1 },
      { value: "FR", visitors: 1, views: 1 },
    ]);
  });

  it("under a path filter older than the log, counts the page's views per value, not the visits that entered on it", async () => {
    const { insights, app, visit, query, logStart } = await setup();
    const a = await app();
    const old = new Date(logStart - 20 * DAY).toISOString();
    await visit({
      sigilId: a,
      visitor: "v1",
      start: old,
      views: [
        { path: "/x", minute: 0 },
        { path: "/y", minute: 1 },
      ],
    });
    await visit({
      sigilId: a,
      visitor: "v2",
      start: old,
      views: [
        { path: "/y", minute: 0 },
        { path: "/x", minute: 1 },
      ],
      country: "DE",
    });
    const range = { from: logStart - 30 * DAY, to: logStart - 5 * DAY };
    const countries = await insights.leaderboard(
      query({ sigilIds: [a], ...range, filters: { path: "/x" } }),
      "country",
      10,
    );
    expect(countries.rows).toEqual([
      { value: "DE", visitors: null, views: 1 },
      { value: "FR", visitors: null, views: 1 },
    ]);
  });
});

/**
 * The Postgres lane runs this file against Postgres, where a SQLite stand-in
 * for D1 cannot boot.
 */
const onPostgres = process.env.DATABASE_TEST_DIALECT === "postgres";

describe.skipIf(onPostgres)("SigilInsightsService on D1", () => {
  it("reads more than 100 apps without binding more than 100 values", async () => {
    const { insights, app, visit, query } = await setup({ d1: true });
    const a = await app();
    await visit({
      sigilId: a,
      visitor: "v1",
      start: "2026-11-02T10:00:00.000Z",
      views: [{ path: "/", minute: 0 }],
    });
    const sigilIds = [
      a,
      ...Array.from({ length: 150 }, () => crypto.randomUUID()),
    ];
    const reading = await insights.read(
      query({
        sigilIds,
        from: Date.parse("2026-07-01T00:00:00.000Z"),
        grain: "month",
      }),
    );
    expect(reading.totals).toMatchObject({ visitors: 1, visits: 1, views: 1 });
    const board = await insights.leaderboard(query({ sigilIds }), "country", 5);
    expect(board.rows).toEqual([{ value: "FR", visitors: 1, views: 1 }]);
  });
});
