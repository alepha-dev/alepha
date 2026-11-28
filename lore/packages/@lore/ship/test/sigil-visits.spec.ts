import type { SigilForwarded } from "@alepha/lore/sigil";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm, DatabaseProvider } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import {
  DeployAnalytics,
  LoreShipApi,
  SigilIngestService,
  SigilJobs,
} from "../src/api/index.ts";
import {
  type Sigil,
  sigilSessions,
  sigilVisits,
  sigils,
} from "../src/schemas/index.ts";
import { createTestProject, DeployTestEntities } from "../src/testing/index.ts";

class Repositories {
  sigils = $repository(sigils);
  sessions = $repository(sigilSessions);
  visits = $repository(sigilVisits);
}

const MIN = 60_000;

/**
 * The ingest service itself, on SQLite, with a paused clock: every test
 * sets "now" and sends events relative to it.
 */
const setup = async (at = "2026-11-10T12:00:00.000Z") => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreShipApi);
  alepha.inject(DeployTestEntities);
  const repos = alepha.inject(Repositories);
  const service = alepha.inject(SigilIngestService);
  const jobs = alepha.inject(SigilJobs);
  const analytics = alepha.inject(DeployAnalytics);
  const dateTime = alepha.inject(DateTimeProvider);
  await alepha.start();

  dateTime.pause();
  await dateTime.travel(Date.parse(at) - dateTime.nowMillis());

  const project = await createTestProject(alepha, {
    capabilities: [{ key: "ship", options: { track: true } }],
  });
  const sigil = (await repos.sigils.create({
    projectId: project.id,
    name: "demo",
    tokenHash: "hash",
    tokenPrefix: "sg_test",
    kinds: ["beacon"],
  })) as Sigil;

  const now = () => dateTime.nowMillis();
  const send = (envelope: Partial<SigilForwarded>) =>
    service.absorb(sigil, {
      visitor: "visitor-1",
      visitorPeriod: "2026-11",
      country: "FR",
      device: "desktop",
      traffic: "human",
      browser: "chrome",
      os: "macos",
      auth: "anon",
      ...envelope,
    } as SigilForwarded);
  const travelTo = (iso: string) => dateTime.travel(Date.parse(iso) - now());

  return { alepha, repos, jobs, analytics, sigil, send, now, travelTo };
};

describe("sessions", () => {
  it("reuses a returning visitor's session within a period, and opens one per new period", async () => {
    const { repos, send, travelTo, now } = await setup();
    await send({ views: [{ path: "/", ts: now() }] });
    await travelTo("2026-11-20T12:00:00.000Z");
    await send({ views: [{ path: "/a", ts: now() }] });
    await travelTo("2026-12-01T09:00:00.000Z");
    await send({ visitorPeriod: "2026-12", views: [{ path: "/", ts: now() }] });

    const sessions = await repos.sessions.findMany({
      orderBy: { column: "firstSeenAt", direction: "asc" },
    });
    expect(sessions.map((s) => s.period)).toEqual(["2026-11", "2026-12"]);
    expect(sessions[0].lastSeenAt).toBe("2026-11-20T12:00:00.000Z");
    expect(sessions[0].periodEndsAt).toBe("2026-12-01T00:00:00.000Z");
  });

  it("never moves a session's window inwards when a late batch arrives", async () => {
    const { repos, send, now } = await setup();
    const at = now();
    await send({ views: [{ path: "/", ts: at - 10 * 60_000 }] });
    await send({ views: [{ path: "/late", ts: at - 40 * 60_000 }] });
    await send({ views: [{ path: "/b", ts: at - 20 * 60_000 }] });
    const [session] = await repos.sessions.findMany({});
    expect(session.firstSeenAt).toBe(new Date(at - 40 * 60_000).toISOString());
    expect(session.lastSeenAt).toBe(new Date(at - 10 * 60_000).toISOString());
  });

  it("files a batch from an older client, with no visitorPeriod, in a daily session", async () => {
    const { repos, send, now } = await setup();
    await send({ visitorPeriod: undefined, views: [{ path: "/", ts: now() }] });
    const [session] = await repos.sessions.findMany({});
    expect(session.period).toBe("2026-11-10");
    expect(session.periodEndsAt).toBe("2026-11-11T00:00:00.000Z");
  });

  it("treats a malformed visitorPeriod, or one neither current nor previous, as absent", async () => {
    const { repos, send, now } = await setup();
    // Ten days into November, October is past its grace too.
    for (const visitorPeriod of [
      "garbage",
      "2026-09",
      "2026-10",
      "2027-01",
      "2026-W99",
    ]) {
      await send({ visitorPeriod, views: [{ path: "/", ts: now() }] });
    }
    const periods = (await repos.sessions.findMany({})).map((s) => s.period);
    expect(periods).toEqual(["2026-11-10"]);
  });

  it("accepts the previous period for six hours after it ends, a batch held across the boundary", async () => {
    const { repos, send, now, travelTo } = await setup();
    await travelTo("2026-11-01T05:00:00.000Z");
    await send({ visitorPeriod: "2026-10", views: [{ path: "/", ts: now() }] });
    await travelTo("2026-11-01T07:00:00.000Z");
    await send({
      visitor: "visitor-2",
      visitorPeriod: "2026-10",
      views: [{ path: "/", ts: now() }],
    });
    const periods = (await repos.sessions.findMany({})).map((s) => s.period);
    expect(periods.sort((a, b) => a.localeCompare(b))).toEqual([
      "2026-10",
      "2026-11-01",
    ]);
  });
});

describe("visits", () => {
  it("joins views under 30 minutes apart by event time, and opens a second visit after a longer gap", async () => {
    const { repos, send, now } = await setup();
    const start = now() - 3 * 60 * MIN;
    await send({
      views: [{ path: "/", ts: start, entry: true, referrer: "news.example" }],
    });
    await send({ views: [{ path: "/a", ts: start + 20 * MIN }] });
    await send({ views: [{ path: "/b", ts: start + 90 * MIN }] });

    const visits = await repos.visits.findMany({
      orderBy: { column: "startedAt", direction: "asc" },
    });
    expect(visits).toHaveLength(2);
    expect(visits[0]).toMatchObject({
      views: 2,
      entryPath: "/",
      exitPath: "/a",
      referrer: "news.example",
    });
    expect(visits[1]).toMatchObject({ views: 1, entryPath: "/b" });
  });

  it("builds the same visits whatever order the batches arrive in", async () => {
    const shapes = [];
    for (const order of [
      [0, 20, 90],
      [90, 20, 0],
      [20, 90, 0],
    ]) {
      const { repos, send, now } = await setup();
      const start = now() - 3 * 60 * MIN;
      for (const minute of order) {
        await send({
          views: [{ path: `/${minute}`, ts: start + minute * MIN }],
        });
      }
      const visits = await repos.visits.findMany({
        orderBy: { column: "startedAt", direction: "asc" },
      });
      shapes.push(
        visits.map((v) => [v.views, v.entryPath, v.exitPath, v.startedAt]),
      );
    }
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
    expect(shapes[0].map((v) => v[0])).toEqual([2, 1]);
    // Three apps booted in turn: past the default 10 s on Postgres.
  }, 30_000);

  it("records the visit's dimensions, network included, and an engagement marks it engaged", async () => {
    const { repos, send, now } = await setup();
    await send({
      network: { number: 13335, name: "Cloudflare, Inc." },
      views: [{ path: "/", ts: now() }],
      engagements: [{ path: "/", ts: now() }],
    });
    const [visit] = await repos.visits.findMany({});
    expect(visit).toMatchObject({
      views: 1,
      engaged: true,
      country: "FR",
      device: "desktop",
      browser: "chrome",
      os: "macos",
      traffic: "human",
      auth: "anon",
      network: "AS13335 Cloudflare, Inc.",
    });
  });

  it("gives a declared bot no session and no visit, and sigil_views still receives its views", async () => {
    const { repos, analytics, sigil, send, now } = await setup();
    await send({ traffic: "bot", views: [{ path: "/", ts: now() }] });
    expect(await repos.sessions.findMany({})).toHaveLength(0);
    expect(await repos.visits.findMany({})).toHaveLength(0);
    const views = await analytics.views.query({
      since: "2026-11-01",
      where: { sigilId: sigil.id },
      groupBy: ["traffic"],
      select: { count: "sum" },
    });
    expect(views.rows).toEqual([{ traffic: "bot", count: 1 }]);
  });
});

describe("the cost of a batch", () => {
  it("is three statements more than a bot's, the session upsert, the visit read and the visit write, in that order", async () => {
    const { alepha, send, now } = await setup();
    const database = alepha.inject(DatabaseProvider);
    const statement = database.statement.bind(database);
    let count = 0;
    database.statement = ((...args: Parameters<typeof statement>) => {
      count++;
      return statement(...args);
    }) as typeof database.statement;

    const measure = async (envelope: Partial<SigilForwarded>) => {
      count = 0;
      await send(envelope);
      return count;
    };
    // Warm the per-sigil caches (`gatesFor`) out of the measurement.
    await measure({ traffic: "bot", views: [{ path: "/", ts: now() }] });

    const bot = await measure({
      traffic: "bot",
      views: [{ path: "/", ts: now() }],
    });
    const opening = await measure({ views: [{ path: "/", ts: now() }] });
    const joining = await measure({ views: [{ path: "/a", ts: now() }] });
    expect(opening - bot).toBe(3);
    expect(joining - bot).toBe(3);
  });
});

describe("SigilJobs.expireVisitorsNow", () => {
  /**
   * Sessions and visits written straight to the tables, and the sweep run at
   * an explicit instant: `travel()` would fire the hourly crons on the way,
   * this very job among them.
   */
  const seed = async (
    repos: Repositories,
    sigilId: string,
    rows: Array<{ hash: string; period: string; endsAt: string; seen: string }>,
  ) => {
    for (const row of rows) {
      const id = crypto.randomUUID();
      await repos.sessions.create({
        id,
        sigilId,
        period: row.period,
        periodEndsAt: row.endsAt,
        visitorHash: row.hash,
        firstSeenAt: row.seen,
        lastSeenAt: row.seen,
      });
      await repos.visits.create({
        id: crypto.randomUUID(),
        sigilId,
        sessionId: id,
        startedAt: row.seen,
        lastSeenAt: row.seen,
        views: 1,
        engaged: false,
        entryPath: "/",
        exitPath: "/",
        referrer: "direct",
        campaign: "none",
        country: "FR",
        device: "desktop",
        browser: "chrome",
        os: "macos",
        traffic: "human",
        auth: "anon",
      });
    }
  };

  it("erases the hash of every session whose period has ended, and prunes sessions and visits past 400 days", async () => {
    const { repos, jobs, sigil } = await setup();
    await seed(repos, sigil.id, [
      {
        hash: "old",
        period: "2025-09",
        endsAt: "2025-10-01T00:00:00.000Z",
        seen: "2025-09-20T10:00:00.000Z",
      },
      {
        hash: "ended",
        period: "2026-10",
        endsAt: "2026-11-01T00:00:00.000Z",
        seen: "2026-10-30T10:00:00.000Z",
      },
      {
        hash: "running",
        period: "2026-11",
        endsAt: "2026-12-01T00:00:00.000Z",
        seen: "2026-11-10T10:00:00.000Z",
      },
    ]);

    const at = Date.parse("2026-11-10T12:00:00.000Z");
    expect(await jobs.expireVisitorsNow(at)).toEqual({
      erased: 2,
      visits: 1,
      sessions: 1,
    });
    const sessions = await repos.sessions.findMany({
      orderBy: { column: "period", direction: "asc" },
    });
    expect(sessions.map((s) => [s.period, s.visitorHash ?? null])).toEqual([
      ["2026-10", null],
      ["2026-11", "running"],
    ]);
    expect(await repos.visits.findMany({})).toHaveLength(2);
    expect(await jobs.expireVisitorsNow(at)).toEqual({
      erased: 0,
      visits: 0,
      sessions: 0,
    });
  });

  it("keeps a hash for six hours past its period's end, while a late batch may still name it", async () => {
    const { repos, jobs, sigil } = await setup();
    await seed(repos, sigil.id, [
      {
        hash: "just-ended",
        period: "2026-11-09",
        endsAt: "2026-11-10T00:00:00.000Z",
        seen: "2026-11-09T23:50:00.000Z",
      },
    ]);
    expect(
      (await jobs.expireVisitorsNow(Date.parse("2026-11-10T05:00:00.000Z")))
        .erased,
    ).toBe(0);
    expect(
      (await jobs.expireVisitorsNow(Date.parse("2026-11-10T06:00:00.000Z")))
        .erased,
    ).toBe(1);
  });

  it("is bounded per sweep, and the next sweep finishes the backlog", async () => {
    const { repos, jobs, sigil } = await setup();
    await seed(
      repos,
      sigil.id,
      ["a", "b", "c"].map((hash) => ({
        hash,
        period: "2026-10",
        endsAt: "2026-11-01T00:00:00.000Z",
        seen: "2026-10-20T10:00:00.000Z",
      })),
    );
    const at = Date.parse("2026-11-10T12:00:00.000Z");
    const cap = SigilJobs.MAX_VISITOR_ROWS_PER_SWEEP;
    SigilJobs.MAX_VISITOR_ROWS_PER_SWEEP = 2;
    try {
      expect((await jobs.expireVisitorsNow(at)).erased).toBe(2);
      expect((await jobs.expireVisitorsNow(at)).erased).toBe(1);
    } finally {
      SigilJobs.MAX_VISITOR_ROWS_PER_SWEEP = cap;
    }
    const hashes = (await repos.sessions.findMany({})).map(
      (s) => s.visitorHash ?? null,
    );
    expect(hashes).toEqual([null, null, null]);
  });
});
