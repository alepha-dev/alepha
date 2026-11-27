import {
  DashboardMetricRegistry,
  HostInventoryService,
  ProjectDashboardController,
} from "@lore/core/api";
import {
  type DashboardCardValue,
  type HostInventoryApp,
  hostProjects,
  hosts,
  type Project,
  projectCapabilities,
  qualityRuns,
} from "@lore/core/schemas";
import { ReadCounter } from "@lore/core/testing";
import { DeployAnalytics } from "@lore/ship/api";
import {
  appInstances,
  deployments,
  sigils,
  sigilUniquesDaily,
} from "@lore/ship/schemas";
import { Alepha } from "alepha";
import { AlephaApiUsers, users } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestMember,
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

class AppsRepositories {
  sigils = $repository(sigils);
  instances = $repository(appInstances);
  deployments = $repository(deployments);
  quality = $repository(qualityRuns);
  uniques = $repository(sigilUniquesDaily);
  capabilities = $repository(projectCapabilities);
  users = $repository(users);
  hosts = $repository(hosts);
  grants = $repository(hostProjects);
}

/**
 * The apps tiles of #E77 (#Q2657): per-copy health, the error trend with
 * its deployments, coverage, the visitors sparkline, and the apps slot's
 * data gate (an app heard from in 30 days).
 */
describe("dashboard apps tiles", () => {
  let alepha: Alepha;
  let repos: AppsRepositories;
  let dateTime: DateTimeProvider;
  let project: Project;
  let user: UserAccountToken;
  let seq = 0;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    bootLore(alepha);
    alepha.with(ReadCounter);
    alepha.inject(TestEntityRepositories);
    repos = alepha.inject(AppsRepositories);
    await alepha.start();
    dateTime = alepha.inject(DateTimeProvider);
    project = await createTestProject(alepha);
    await createTestMember(alepha, project, project.createdBy!);
    user = { id: project.createdBy!, roles: ["user"] };
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const resolve = async (
    metric: string,
    scope?: { kind: "apps"; sigilIds: string[] },
    height = 1,
  ): Promise<DashboardCardValue> =>
    (
      await alepha.inject(DashboardMetricRegistry).resolveForProject(
        [
          {
            id: 1,
            metric,
            scope: scope ?? { kind: "projects", projectIds: [project.id] },
            filters: {},
            size: 1,
            height,
            position: 0,
          },
        ],
        user,
        project,
      )
    )[0]!;

  const copy = async (
    app: string,
    env: string,
    kinds: string[],
    hoursAgo?: number,
  ) => {
    seq += 1;
    const sigil = await repos.sigils.create({
      projectId: project.id,
      name: `${app}/${env}`,
      tokenHash: `apps-hash-${seq}`,
      tokenPrefix: `sg_a${seq}`,
      kinds,
      lastSeenAt:
        hoursAgo === undefined
          ? undefined
          : dateTime.now().subtract(hoursAgo, "hour").toISOString(),
    });
    const instance = await repos.instances.create({
      projectId: project.id,
      app,
      env,
      sigilId: sigil.id,
    });
    return { sigil, instance };
  };

  const slots = async () =>
    (
      await alepha
        .inject(ProjectDashboardController)
        .getProjectDashboard.fetch(
          { params: { projectId: project.id } },
          { user },
        )
    ).data.cards
      .filter((card) => card.slot === "apps")
      .map((card) => card.metric);

  describe("appHealth", () => {
    it("draws one pill per copy from its deploy and its liveness", async ({
      expect,
    }) => {
      const web = await copy("web", "production", ["errors"], 1);
      await copy("web", "staging", ["errors"], 72);
      await copy("api", "production", ["errors"], 1);
      await repos.deployments.create({
        projectId: project.id,
        instanceId: web.instance.id,
        app: "web",
        tag: "1.2.0",
        sha256: "f".repeat(64),
        status: "failed",
      });

      const value = await resolve("appHealth");

      expect(
        Object.fromEntries(
          (value.rows ?? []).map((row) => [row.id, row.state]),
        ),
      ).toEqual({
        "api/production": "ok",
        "web/production": "bad",
        "web/staging": "warn",
      });
      expect(value.value).toBe(1);
      expect(value.detail.heard).toBe(true);
    });

    it("answers noSigil with no app copy", async ({ expect }) => {
      expect((await resolve("appHealth")).empty).toBe("noSigil");
    });
  });

  describe("errorTrend", () => {
    it("zero-fills the window and marks each deployment", async ({
      expect,
    }) => {
      const web = await copy("web", "production", ["errors"], 1);
      await repos.deployments.create({
        projectId: project.id,
        instanceId: web.instance.id,
        app: "web",
        tag: "1.3.0",
        sha256: "e".repeat(64),
        status: "succeeded",
        finishedAt: dateTime.nowISOString(),
      });

      const value = await resolve("errorTrend");

      expect(value.series).toHaveLength(14);
      expect(value.value).toBe(0);
      expect(value.markers).toEqual([
        expect.objectContaining({ kind: "deploy" }),
      ]);
    });
  });

  describe("qualityTrend", () => {
    it("reads line coverage from the recorded runs, with the latest tests", async ({
      expect,
    }) => {
      for (const [day, lines] of [
        ["2026-10-12", 70.2],
        ["2026-10-13", 72.8],
      ] as const) {
        await repos.quality.create({
          projectId: project.id,
          day,
          commitSha: `abcdef${day.slice(-1)}`,
          branch: "main",
          coverageLines: lines,
          coverageStatements: lines,
          coverageFunctions: lines,
          coverageBranches: lines,
          testsTotal: 100,
          testsPassed: 99,
          testsFailed: 1,
          testsSkipped: 0,
          durationMs: 1000,
        });
      }

      const value = await resolve("qualityTrend");

      expect(value.value).toBe(73);
      expect(value.series?.map((point) => point.at)).toEqual([
        "2026-10-12",
        "2026-10-13",
      ]);
      expect(value.detail).toMatchObject({
        testsPassed: 99,
        changePoints: 2.6,
      });
    });
  });

  describe("uniqueVisitors", () => {
    it("gains a sparkline over the window", async ({ expect }) => {
      const docs = await copy("docs", "production", ["beacon"], 1);
      // The last complete UTC day, as `DailyVisitorsService` counts it: a
      // zoned `subtract(1, "day")` under the Paris TZ crosses a DST change an
      // hour short and lands on the day before (#Q2705).
      const yesterday = new Date(dateTime.nowMillis() - 86_400_000)
        .toISOString()
        .slice(0, 10);
      for (const visitorHash of ["a", "b"]) {
        await repos.uniques.create({
          sigilId: docs.sigil.id,
          day: yesterday,
          visitorHash,
        });
      }

      const value = await resolve("uniqueVisitors");

      expect(value.series).toHaveLength(14);
      expect(value.series?.[13]).toEqual({ at: yesterday, value: 2 });
    });
  });

  describe("webVitals", () => {
    const record = async (
      sigilId: string,
      metric: string,
      bucket: number,
      samples: number,
    ) =>
      alepha.inject(DeployAnalytics).vitals.recordMany([
        {
          sigilId,
          hour: dateTime.nowISOString().slice(0, 13),
          metric,
          path: "/",
          bucket,
          samples,
        },
      ]);

    it("draws the p75 range of LCP, INP and CLS, rated, and neutral on too few samples (#Q4521)", async ({
      expect,
    }) => {
      const web = await copy("web", "production", ["beacon"], 1);
      // LCP: 1.0 to 1.8 s, good. INP: 400 to 500 ms, needs improvement.
      // CLS: ten samples, not enough to rate.
      await record(web.sigil.id, "lcp", 1, 100);
      await record(web.sigil.id, "inp", 4, 50);
      await record(web.sigil.id, "cls", 0, 10);

      const value = await resolve("webVitals");

      expect(value.empty).toBeUndefined();
      expect(
        value.rows?.map((row) => ({ id: row.id, state: row.state })),
      ).toEqual([
        { id: "LCP 1–1.8 s", state: "ok" },
        { id: "INP 400–500 ms", state: "warn" },
        { id: "CLS ≤ 0.05", state: "neutral" },
      ]);
      expect(value.detail).toMatchObject({
        days: 14,
        rated: 2,
        samples: { lcp: 100, inp: 50, cls: 10 },
      });
      expect(value.link).toEqual({
        route: "appVitals",
        params: { projectSlug: project.slug, app: "web", env: "production" },
      });
    });

    it("rates a p75 past the last boundary poor", async ({ expect }) => {
      const web = await copy("web", "production", ["beacon"], 1);
      await record(web.sigil.id, "lcp", 6, 40);

      const value = await resolve("webVitals");

      expect(value.rows?.[0]).toMatchObject({ id: "LCP > 6 s", state: "bad" });
    });

    it("is empty when no copy reported a vital in the window, or none sends the beacon", async ({
      expect,
    }) => {
      expect((await resolve("webVitals")).empty).toBe("noSigil");
      await copy("api", "production", ["errors"], 1);
      expect((await resolve("webVitals")).empty).toBe("noBeacon");
      await copy("web", "production", ["beacon"], 1);
      expect((await resolve("webVitals")).empty).toBe("noData");
    });
  });

  describe("recentDeployments", () => {
    // The tile needs Ship's deploy option, which the fixture leaves off.
    beforeEach(async () => {
      await repos.capabilities.updateMany(
        { projectId: { eq: project.id }, key: { eq: "ship" } },
        { options: { track: true, deploy: true } },
      );
      await repos.users.updateById(user.id, { firstName: "ada" });
    });

    const deploy = async (
      instanceId: string,
      tag: string,
      status: "queued" | "running" | "succeeded" | "failed" | "cancelled",
      minutesAgo: number,
      extra: { versionId?: string; createdBy?: string } = {},
    ) => {
      const at = dateTime.now().subtract(minutesAgo, "minute").toISOString();
      return repos.deployments.create({
        projectId: project.id,
        instanceId,
        app: "web",
        tag,
        sha256: "d".repeat(64),
        status,
        createdAt: at,
        startedAt: at,
        ...(status === "queued" || status === "running"
          ? {}
          : { finishedAt: at }),
        ...extra,
      });
    };

    it("lists every copy's deployments newest first, with status, tone and author (#Q4522)", async ({
      expect,
    }) => {
      const prod = await copy("web", "production", ["errors"], 1);
      const staging = await copy("web", "staging", ["errors"], 1);
      await deploy(prod.instance.id, "1.0.0", "succeeded", 60, {
        versionId: "v-1",
        createdBy: user.id,
      });
      await deploy(prod.instance.id, "1.1.0", "succeeded", 40, {
        versionId: "v-2",
      });
      // A fast rollback re-points the copy at an earlier run's version.
      await deploy(prod.instance.id, "1.0.0", "succeeded", 30, {
        versionId: "v-1",
      });
      await deploy(staging.instance.id, "1.2.0", "failed", 20);
      await deploy(staging.instance.id, "1.2.1", "running", 5);

      const value = await resolve("recentDeployments", undefined, 2);

      expect(
        value.rows?.map((row) => ({
          id: row.id,
          title: row.title,
          badge: row.badge,
          state: row.state,
        })),
      ).toEqual([
        {
          id: "web/staging",
          title: "1.2.1",
          badge: "running",
          state: "accent",
        },
        { id: "web/staging", title: "1.2.0", badge: "failed", state: "bad" },
        {
          id: "web/production",
          title: "1.0.0",
          badge: "rolledBack",
          state: "warn",
        },
        {
          id: "web/production",
          title: "1.1.0",
          badge: "succeeded",
          state: "ok",
        },
        {
          id: "web/production",
          title: "1.0.0",
          badge: "succeeded",
          state: "ok",
        },
      ]);
      expect(value.rows?.[4]?.excerpt).toBe("Ada");
      expect(value.rows?.[3]?.excerpt).toBeUndefined();
      expect(value.rows?.[0]?.link).toEqual({
        route: "appDeploy",
        params: { projectSlug: project.slug, app: "web", env: "staging" },
      });
      expect(value.link).toEqual({
        route: "projectApps",
        params: { projectSlug: project.slug },
      });
      expect(value.detail).toEqual({ failed: 1 });
      // A tile one row high shows what fits above its "See all".
      expect(
        (await resolve("recentDeployments")).rows?.map((row) => row.title),
      ).toEqual(["1.2.1", "1.2.0"]);
    });

    it("keeps a failed or running rollback's own status, and finds the run it went back to however far back", async ({
      expect,
    }) => {
      const prod = await copy("web", "production", ["errors"], 1);
      await deploy(prod.instance.id, "1.0.0", "succeeded", 600, {
        versionId: "v-1",
      });
      for (let i = 0; i < 12; i++) {
        await deploy(prod.instance.id, `1.1.${i}`, "succeeded", 500 - i, {
          versionId: `v-2-${i}`,
        });
      }
      await deploy(prod.instance.id, "1.0.0", "failed", 30, {
        versionId: "v-1",
      });
      await deploy(prod.instance.id, "1.0.0", "running", 20, {
        versionId: "v-1",
      });
      await deploy(prod.instance.id, "1.0.0", "succeeded", 10, {
        versionId: "v-1",
      });

      const value = await resolve("recentDeployments", undefined, 2);

      expect(value.rows?.slice(0, 3).map((row) => row.badge)).toEqual([
        "rolledBack",
        "running",
        "failed",
      ]);
    });

    it("never lets a preview copy's runs push a lasting copy's off the tile", async ({
      expect,
    }) => {
      const prod = await copy("web", "production", ["errors"], 1);
      const preview = await copy("web", "pr-1", ["errors"], 1);
      await repos.instances.updateById(preview.instance.id, {
        ephemeral: true,
      });
      await deploy(prod.instance.id, "1.0.0", "succeeded", 600);
      for (let i = 0; i < 60; i++) {
        await deploy(preview.instance.id, `pr-${i}`, "succeeded", 300 - i);
      }

      const value = await resolve("recentDeployments");

      expect(value.rows?.map((row) => row.title)).toEqual(["1.0.0"]);
    });

    it("follows only the copies of a scope of apps", async ({ expect }) => {
      const prod = await copy("web", "production", ["errors"], 1);
      const staging = await copy("web", "staging", ["errors"], 1);
      await deploy(prod.instance.id, "1.0.0", "succeeded", 10);
      await deploy(staging.instance.id, "1.1.0", "succeeded", 5);

      const value = await resolve("recentDeployments", {
        kind: "apps",
        sigilIds: [prod.sigil.id],
      });

      expect(value.rows?.map((row) => row.id)).toEqual(["web/production"]);
    });

    it("is empty while the scope has no deployment", async ({ expect }) => {
      expect((await resolve("recentDeployments")).empty).toBe("noDeployment");
      await copy("web", "production", ["errors"], 1);
      expect((await resolve("recentDeployments")).empty).toBe("noDeployment");
    });
  });

  describe("backupFreshness", () => {
    /**
     * A copy deployed to a Bay of the project, and the inventory that
     * machine last pushed for it.
     */
    const onBay = async (
      copies: Array<{
        app: string;
        env: string;
        reported: Partial<HostInventoryApp>;
      }>,
    ) => {
      const host = await repos.hosts.create({
        projectId: project.id,
        ownerUserId: project.createdBy!,
        type: "bay",
        slug: `bay-${seq + 1}`,
      });
      await repos.grants.create({ hostId: host.id, projectId: project.id });
      const made = [];
      for (const it of copies) {
        const made1 = await copy(it.app, it.env, ["errors"], 1);
        await repos.instances.updateById(made1.instance.id, {
          hostId: host.id,
          resourceHostId: host.id,
          resourceName: `${it.app}-${it.env}`,
        });
        made.push(made1);
      }
      await alepha.inject(HostInventoryService).record(host, {
        type: "inventory",
        at: dateTime.nowISOString(),
        host: { cores: 2, memTotalBytes: 1024 ** 3 },
        apps: copies.map((it) => ({
          app: it.app,
          env: it.env,
          running: true,
          backups: true,
          problems: [],
          ...it.reported,
        })),
      });
      return made;
    };

    const ago = (hours: number) =>
      dateTime.now().subtract(hours, "hour").toISOString();

    it("lists each backed up copy, worst first, with its size, age and Bay's state (#Q4523)", async ({
      expect,
    }) => {
      await onBay([
        {
          app: "web",
          env: "production",
          reported: {
            backup: {
              state: "ok",
              last: { at: ago(2), key: "k1", storedBytes: 48 * 1024 * 1024 },
            },
          },
        },
        {
          app: "web",
          env: "staging",
          reported: {
            backup: {
              state: "stale",
              last: {
                at: "2026-01-02T03:04:05.000Z",
                key: "k2",
                storedBytes: 1536,
              },
            },
          },
        },
        {
          app: "api",
          env: "production",
          reported: {
            backup: {
              state: "failing",
              last: { at: ago(30), key: "k3", storedBytes: 2_000_000 },
              failure: {
                at: ago(1),
                message: "bucket unreachable",
                consecutive: 2,
              },
            },
          },
        },
        // An older Bay: the flat fields only.
        {
          app: "docs",
          env: "production",
          reported: { lastBackupAt: ago(5) },
        },
        // A state a later Bay adds: untoned, never fresh.
        {
          app: "jobs",
          env: "production",
          reported: { backup: { state: "paused" } },
        },
        // Backups off: no row.
        {
          app: "cron",
          env: "production",
          reported: { backups: false, backup: { state: "off" } },
        },
      ]);

      const value = await resolve("backupFreshness");

      expect(
        value.rows?.map((row) => ({
          id: row.id,
          title: row.title,
          badge: row.badge,
          state: row.state,
        })),
      ).toEqual([
        {
          id: "api/production",
          title: "1.9 MB",
          badge: "backupFailing",
          state: "bad",
        },
        {
          id: "web/staging",
          title: "1.5 KB",
          badge: "backupStale",
          state: "warn",
        },
        { id: "docs/production", title: "", badge: undefined, state: "ok" },
        {
          id: "web/production",
          title: "48 MB",
          badge: undefined,
          state: "ok",
        },
        {
          id: "jobs/production",
          title: "",
          badge: undefined,
          state: "neutral",
        },
      ]);
      expect(value.rows?.[1]?.at).toBe("2026-01-02T03:04:05.000Z");
      expect(value.rows?.[0]?.link).toEqual({
        route: "appBackups",
        params: { projectSlug: project.slug, app: "api", env: "production" },
      });
      expect(value.value).toBe(2);
    });

    it("follows only the copies of a scope of apps", async ({ expect }) => {
      const [prod] = await onBay([
        {
          app: "web",
          env: "production",
          reported: { lastBackupAt: ago(1) },
        },
        { app: "web", env: "staging", reported: { lastBackupAt: ago(1) } },
      ]);

      const value = await resolve("backupFreshness", {
        kind: "apps",
        sigilIds: [prod!.sigil.id],
      });

      expect(value.rows?.map((row) => row.id)).toEqual(["web/production"]);
    });

    it("is empty while no copy in scope is backed up", async ({ expect }) => {
      expect((await resolve("backupFreshness")).empty).toBe("noBackup");
      // Deployed nowhere.
      await copy("api", "production", ["errors"], 1);
      expect((await resolve("backupFreshness")).empty).toBe("noBackup");
      // On a Bay that does not back it up.
      await onBay([
        {
          app: "web",
          env: "production",
          reported: { backups: false },
        },
      ]);
      expect((await resolve("backupFreshness")).empty).toBe("noBackup");
    });
  });

  describe("the apps slot", () => {
    it("is absent with no sigil", async ({ expect }) => {
      expect(await slots()).toEqual([]);
    });

    it("is absent when every app is silent", async ({ expect }) => {
      await copy("site", "production", ["errors"], 24 * 40);

      expect(await slots()).toEqual([]);
    });

    it("leads with health once an app reported this month", async ({
      expect,
    }) => {
      await copy("site", "production", ["errors"], 2);

      expect(await slots()).toEqual(["appHealth"]);
    });
  });
});
