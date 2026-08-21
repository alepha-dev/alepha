import { SIGIL_INGEST_PATH } from "@alepha/sigil/paths";
import { Alepha, AlephaError } from "alepha";
import {
  type AnalyticsDataset,
  AnalyticsProvider,
  type AnalyticsRow,
  MemoryAnalyticsProvider,
} from "alepha/api/analytics";
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
import { LoreApi } from "../src/api/index.ts";
import { SigilTokenService } from "../src/api/services/SigilTokenService.ts";

/**
 * A provider that always fails to record. Used to prove that once
 * `SigilIngestService` writes views and vitals through `$analytics()` alone
 * (Task 14 retired the dual-write into `sigilViewsHourly` /
 * `sigilVitalsHourly` this file used to also assert on), a failure on that
 * write is no longer swallowed — see `SigilIngestService.absorbViews`'s doc
 * for why the old mirror's failure-isolating try/catch does not survive the
 * legacy write it used to protect.
 */
class ThrowingAnalyticsProvider extends MemoryAnalyticsProvider {
  public override async record(
    dataset: AnalyticsDataset,
    rows: AnalyticsRow[],
  ): Promise<void> {
    throw new AlephaError("Simulated analytics provider failure");
  }
}

class Probe {
  projects = $repository(projects);
  sigils = $repository(sigils);
}

/**
 * Boots the real ingest HTTP path, the same way `sigil-ingest.spec.ts` does,
 * so the assertions below exercise `SigilIngestService.absorb` exactly as
 * production would, not a hand-called method.
 *
 * `analyticsProvider`, when given, is substituted for `AnalyticsProvider`
 * BEFORE any module wires — a substitution is only honoured the first time
 * it is recorded (`Alepha.with`'s "first call wins, later calls are
 * no-ops when `optional`" rule), and `AlephaApiAnalytics`'s own default pick is
 * exactly that kind of optional call. Recording it here first is what lets a
 * test force the dataset write to fail.
 */
const setup = async (
  analyticsProvider?: new (...args: any[]) => AnalyticsProvider,
) => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      SERVER_HOST: "127.0.0.1",
      DATABASE_URL: ":memory:",
      PUBLIC_URL: "https://lore.test",
    },
  });

  if (analyticsProvider) {
    alepha.with({ provide: AnalyticsProvider, use: analyticsProvider as any });
  }

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

  const minted = await tokens.mint(project.id);
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
   * A real ingest call lands in the dataset — the one and only write for
   * views and vitals now that Task 14 retired the dual-write into
   * `sigilViewsHourly` / `sigilVitalsHourly`.
   */
  it("writes a real ingest call into the dataset", async () => {
    const { analytics, sigil, post } = await setup();

    const res = await post({
      views: [{ path: "/home" }],
      vitals: [{ path: "/home", metric: "lcp", value: 900 }],
    });
    expect(res.status).toBe(204);

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

  /**
   * The dataset write used to be a mirror alongside a legacy-table write,
   * with its own failure isolated so a transient error on the (then
   * zero-traffic) new path could never turn a healthy ingest into a `5xx` —
   * see the deleted `mirrorAnalyticsWrite`. Now that it is the only write,
   * that isolation would hide real data loss instead of a redundant path
   * failing, so `SigilIngestService.absorbViews` / `absorbVitals` let the
   * error propagate. `lastSeenAt` is asserted unset for the same reason: it
   * is stamped after both absorb calls, so a batch that never finished
   * writing must not look like one that reported successfully.
   */
  it("fails the request when the dataset write fails, since nothing else backs it up", async () => {
    const { probe, sigil, post } = await setup(ThrowingAnalyticsProvider);

    const res = await post({
      views: [{ path: "/home" }],
      vitals: [{ path: "/home", metric: "lcp", value: 900 }],
    });
    expect(res.status).toBe(500);

    const after = await probe.sigils.findOne({
      where: { id: { eq: sigil.id } },
    });
    expect(after?.lastSeenAt).toBeUndefined();
  });
});
