import {
  DashboardMetricRegistry,
  ProjectDashboardController,
} from "@lore/core/api";
import type { DashboardCardValue, Project } from "@lore/core/schemas";
import { ReadCounter } from "@lore/core/testing";
import {
  appInstances,
  deployments,
  qualityRuns,
  sigils,
  sigilUniquesDaily,
} from "@lore/deploy/schemas";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
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

  const resolve = async (metric: string): Promise<DashboardCardValue> =>
    (
      await alepha.inject(DashboardMetricRegistry).resolveForProject(
        [
          {
            id: 1,
            metric,
            scope: { kind: "projects", projectIds: [project.id] },
            filters: {},
            size: 1,
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
      const web = await copy("web", "production", ["blights"], 1);
      await copy("web", "staging", ["blights"], 72);
      await copy("api", "production", ["blights"], 1);
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
      const web = await copy("web", "production", ["blights"], 1);
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
      const yesterday = dateTime
        .now()
        .subtract(1, "day")
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

  describe("the apps slot", () => {
    it("is absent with no sigil (Everyday)", async ({ expect }) => {
      expect(await slots()).toEqual([]);
    });

    it("is absent when every app is silent (Lindocara)", async ({ expect }) => {
      await copy("site", "production", ["blights"], 24 * 40);

      expect(await slots()).toEqual([]);
    });

    it("leads with health once an app reported this month", async ({
      expect,
    }) => {
      await copy("site", "production", ["blights"], 2);

      expect(await slots()).toEqual(["appHealth"]);
    });
  });
});
