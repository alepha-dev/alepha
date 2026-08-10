import { SIGIL_INGEST_PATH } from "@alepha/sigil/paths";
import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import { AlephaServerCors } from "alepha/server/cors";
import { describe, expect, it } from "vitest";
import { LoreAnalytics } from "../src/api/entities/loreAnalytics.ts";
import { projects } from "../src/api/entities/projects.ts";
import { sigils } from "../src/api/entities/sigils.ts";
import { sigilViewsHourly } from "../src/api/entities/sigilViewsHourly.ts";
import { sigilVitalsHourly } from "../src/api/entities/sigilVitalsHourly.ts";
import { LoreApi } from "../src/api/index.ts";
import { SigilTokenService } from "../src/api/services/SigilTokenService.ts";

class Probe {
  projects = $repository(projects);
  sigils = $repository(sigils);
  views = $repository(sigilViewsHourly);
  vitals = $repository(sigilVitalsHourly);
}

/**
 * Boots the real ingest HTTP path, the same way `sigil-ingest.spec.ts` does,
 * so the dual-write assertions below exercise `SigilIngestService.absorb`
 * exactly as production would, not a hand-called method.
 */
const setup = async () => {
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
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const project = await probe.projects.create({
    title: "Test",
    createdBy: owner.id,
    features: {
      kanban: true,
      folios: true,
      feedback: true,
      milestones: true,
      sigils: true,
      blights: true,
      beacon: true,
      vitals: true,
    },
  } as any);

  const minted = tokens.mint();
  const sigil = await probe.sigils.create({
    projectId: project.id,
    name: "demo",
    tokenHash: minted.hash,
    tokenPrefix: minted.prefix,
    kinds: ["beacon", "vitals", "blights", "feedback"],
  });

  const post = (body: unknown) =>
    fetch(`${server.hostname}${SIGIL_INGEST_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${minted.token}`,
      },
      body: JSON.stringify(body),
    });

  return { probe, analytics, sigil, post };
};

describe("Lore analytics datasets", () => {
  it("declares views with the sigil as the index dimension", async () => {
    const alepha = Alepha.create();
    const analytics = alepha.inject(LoreAnalytics);
    await alepha.start();

    expect(analytics.views.dataset.name).toBe("sigil_views");
    expect(analytics.views.dataset.index).toBe("sigilId");
  });

  it("declares vitals with the histogram bucket as an ordinary dimension", async () => {
    const alepha = Alepha.create();
    const analytics = alepha.inject(LoreAnalytics);
    await alepha.start();

    expect(
      Object.keys(analytics.vitals.dataset.dimensions.shape).sort(),
    ).toEqual(["bucket", "metric", "path", "sigilId"].sort());
  });

  it("records a view that reads back grouped by path", async () => {
    const alepha = Alepha.create();
    const analytics = alepha.inject(LoreAnalytics);
    await alepha.start();

    await analytics.views.record({
      sigilId: "s1",
      path: "/docs",
      country: "FR",
      count: 3,
      hour: "2026-08-09T10",
    });

    const result = await analytics.views.query({
      since: "2026-08-09",
      where: { sigilId: { inArray: ["s1"] } },
      groupBy: ["path"],
      select: { count: "sum" },
    });

    expect(result.rows).toEqual([{ path: "/docs", count: 3 }]);
  });

  /**
   * The dual-write guard: a real ingest call must still land in the legacy
   * `sigil_views_hourly` / `sigil_vitals_hourly` tables (what every read
   * still uses through Task 12) AND in the new `$analytics()` datasets. If
   * this task had cut reads over instead of mirroring writes, the legacy
   * tables would come back empty.
   */
  it("writes both the legacy table and the new dataset on ingest", async () => {
    const { probe, analytics, sigil, post } = await setup();

    const res = await post({
      views: [{ path: "/home" }],
      vitals: [{ path: "/home", metric: "lcp", value: 900 }],
    });
    expect(res.status).toBe(204);

    // Legacy tables — still the only thing any read path uses today.
    const legacyViews = await probe.views.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(legacyViews).toHaveLength(1);
    expect(legacyViews[0].count).toBe(1);

    const legacyVitals = await probe.vitals.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(legacyVitals).toHaveLength(1);

    // Mirrored datasets — the new path, unread by anything yet.
    const viewsResult = await analytics.views.query({
      since: "2000-01-01",
      where: { sigilId: { inArray: [sigil.id] } },
      groupBy: ["path"],
      select: { count: "sum" },
    });
    expect(viewsResult.rows).toEqual([{ path: "/home", count: 1 }]);

    const vitalsResult = await analytics.vitals.query({
      since: "2000-01-01",
      where: { sigilId: { inArray: [sigil.id] } },
      groupBy: ["metric"],
      select: { samples: "sum" },
    });
    expect(vitalsResult.rows).toEqual([{ metric: "lcp", samples: 1 }]);
  });
});
