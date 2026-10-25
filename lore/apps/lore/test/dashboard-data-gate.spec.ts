import { DashboardMetricRegistry } from "@lore/core/api";
import type {
  DashboardCardValue,
  DashboardScope,
  Project,
} from "@lore/core/schemas";
import { ReadCounter } from "@lore/core/testing";
import { sigils } from "@lore/deploy/schemas";
import { releases } from "@lore/work/schemas";
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
  createTestEpic,
  createTestMember,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

class GateRepositories {
  sigils = $repository(sigils);
  releases = $repository(releases);
}

/**
 * The data gate of #E77 (#Q2649): a resolver answers `empty` with a reason
 * when its scope holds nothing to measure, and a measured zero stays a value.
 */
describe("dashboard data gate", () => {
  let alepha: Alepha;
  let repos: GateRepositories;
  let registry: DashboardMetricRegistry;
  let dateTime: DateTimeProvider;
  let user: UserAccountToken;
  let project: Project;
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
    repos = alepha.inject(GateRepositories);
    await alepha.start();

    registry = alepha.inject(DashboardMetricRegistry);
    dateTime = alepha.inject(DateTimeProvider);
    project = await createTestProject(alepha);
    await createTestMember(alepha, project, project.createdBy!);
    user = { id: project.createdBy!, roles: ["user"] };
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const card = (metric: string, scope: DashboardScope, filters = {}) => ({
    id: 1,
    metric,
    scope,
    filters,
    size: 1,
    position: 0,
  });

  const onProject = async (
    metric: string,
    scope: DashboardScope,
    filters = {},
  ): Promise<DashboardCardValue> =>
    (
      await registry.resolveForProject(
        [card(metric, scope, filters)],
        user,
        project,
      )
    )[0]!;

  const onHome = async (
    metric: string,
    scope: DashboardScope,
    filters = {},
  ): Promise<DashboardCardValue> =>
    (await registry.resolve([card(metric, scope, filters)], user))[0]!;

  const sigil = async (kinds: string[], lastSeenAt?: string) => {
    seq += 1;
    return repos.sigils.create({
      projectId: project.id,
      name: `app-${seq}/production`,
      tokenHash: `gate-hash-${seq}`,
      tokenPrefix: `sg_g${seq}`,
      kinds,
      lastSeenAt,
    });
  };

  describe("epicProgress", () => {
    it("answers noEpic for an epic with no quest", async ({ expect }) => {
      const epic = await createTestEpic(alepha, project, {
        status: "in_progress",
      });

      const value = await onProject("epicProgress", {
        kind: "epic",
        epicId: epic.id,
      });

      expect(value.ok).toBe(true);
      expect(value.empty).toBe("noEpic");
    });

    it("measures an epic with quests, with done and open segments", async ({
      expect,
    }) => {
      const epic = await createTestEpic(alepha, project, {
        status: "in_progress",
      });
      await createTestQuest(alepha, project, {
        epicId: epic.id,
        completedAt: dateTime.nowISOString(),
      });
      await createTestQuest(alepha, project, { epicId: epic.id });

      const value = await onProject("epicProgress", {
        kind: "epic",
        epicId: epic.id,
      });

      expect(value.empty).toBeUndefined();
      expect(value.value).toBe(50);
      expect(value.segments?.find((it) => it.label === "done")?.value).toBe(1);
    });
  });

  describe("releaseProgress", () => {
    it("answers noRelease for an open release with nothing attached", async ({
      expect,
    }) => {
      const release = await repos.releases.create({
        projectId: project.id,
        number: 1,
        tag: "0.1.0",
        title: "First",
      });

      const value = await onProject("releaseProgress", {
        kind: "release",
        releaseId: release.id,
      });

      expect(value.empty).toBe("noRelease");
    });

    it("reads a fully done open release as readyToPublish, not 100%", async ({
      expect,
    }) => {
      const release = await repos.releases.create({
        projectId: project.id,
        number: 1,
        tag: "0.33.0",
        title: "Done",
      });
      for (let i = 0; i < 3; i += 1) {
        await createTestQuest(alepha, project, {
          releaseId: release.id,
          completedAt: dateTime.nowISOString(),
        });
      }

      const value = await onProject("releaseProgress", {
        kind: "release",
        releaseId: release.id,
      });

      expect(value.empty).toBeUndefined();
      expect(value.value).toBeUndefined();
      expect(value.detail.readyToPublish).toBe(true);
    });
  });

  describe("uniqueVisitors", () => {
    it("answers noSigil when no app reports to the project", async ({
      expect,
    }) => {
      const value = await onHome("uniqueVisitors", {
        kind: "projects",
        projectIds: [project.id],
      });

      expect(value.empty).toBe("noSigil");
    });

    it("answers noBeacon when apps report but none of them page views", async ({
      expect,
    }) => {
      await sigil(["blights"]);

      const value = await onHome("uniqueVisitors", {
        kind: "projects",
        projectIds: [project.id],
      });

      expect(value.empty).toBe("noBeacon");
    });
  });

  describe("openBlights", () => {
    it("answers noSigil at zero when the project has no app", async ({
      expect,
    }) => {
      const value = await onHome("openBlights", {
        kind: "projects",
        projectIds: [project.id],
      });

      expect(value.empty).toBe("noSigil");
    });

    it("answers silent at zero when no app reported in 30 days", async ({
      expect,
    }) => {
      await sigil(
        ["blights"],
        dateTime.now().subtract(40, "day").toISOString(),
      );

      const value = await onHome("openBlights", {
        kind: "projects",
        projectIds: [project.id],
      });

      expect(value.empty).toBe("silent");
    });

    it("keeps a measured zero when an app reported this month", async ({
      expect,
    }) => {
      await sigil(["blights"], dateTime.now().subtract(2, "day").toISOString());

      const value = await onHome("openBlights", {
        kind: "projects",
        projectIds: [project.id],
      });

      expect(value.empty).toBeUndefined();
      expect(value.value).toBe(0);
    });
  });

  describe("zero is a measurement", () => {
    it("keeps activeQuests and heldQuests at zero as values", async ({
      expect,
    }) => {
      const scope: DashboardScope = {
        kind: "projects",
        projectIds: [project.id],
      };

      const active = await onProject("activeQuests", scope);
      const held = await onProject("heldQuests", scope);

      expect(active.empty).toBeUndefined();
      expect(active.value).toBe(0);
      expect(held.empty).toBeUndefined();
      expect(held.value).toBe(0);
    });
  });
});
