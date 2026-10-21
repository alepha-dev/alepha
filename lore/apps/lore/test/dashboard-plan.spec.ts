import {
  DashboardMetricRegistry,
  ProjectDashboardController,
} from "@lore/core/api";
import type { DashboardCardValue, Project } from "@lore/core/schemas";
import { ReadCounter } from "@lore/core/testing";
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

class PlanRepositories {
  releases = $repository(releases);
}

/**
 * The plan tiles of #E77 (#Q2654): the release with its pace, the releases
 * waiting on a publish, the epics in flight and in draft, and the headline
 * and plan slots they fill.
 */
describe("dashboard plan tiles", () => {
  let alepha: Alepha;
  let repos: PlanRepositories;
  let registry: DashboardMetricRegistry;
  let dateTime: DateTimeProvider;
  let project: Project;
  let user: UserAccountToken;
  let releaseSeq = 0;

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
    repos = alepha.inject(PlanRepositories);
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

  const resolve = async (metric: string): Promise<DashboardCardValue> =>
    (
      await registry.resolveForProject(
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

  const release = async (overrides: Record<string, unknown> = {}) => {
    releaseSeq += 1;
    return repos.releases.create({
      projectId: project.id,
      number: releaseSeq,
      tag: `0.${releaseSeq}.0`,
      title: `Release ${releaseSeq}`,
      ...overrides,
    });
  };

  const quests = async (
    releaseId: number,
    done: number,
    open: number,
  ): Promise<void> => {
    for (let i = 0; i < done; i += 1) {
      await createTestQuest(alepha, project, {
        releaseId,
        acceptedAt: dateTime.nowISOString(),
        completedAt: dateTime.nowISOString(),
      });
    }
    for (let i = 0; i < open; i += 1) {
      await createTestQuest(alepha, project, { releaseId });
    }
  };

  const board = async () =>
    (
      await alepha
        .inject(ProjectDashboardController)
        .getProjectDashboard.fetch(
          { params: { projectId: project.id } },
          { user },
        )
    ).data.cards.map((card) => [card.slot, card.metric]);

  describe("releaseOutlook", () => {
    it("answers noRelease when there is no open release with work", async ({
      expect,
    }) => {
      expect((await resolve("releaseOutlook")).empty).toBe("noRelease");
    });

    it("prefers the default release, with its segments", async ({ expect }) => {
      const other = await release({
        targetDate: dateTime.now().add(48, "hour").toISOString(),
      });
      await quests(other.id, 0, 2);
      const chosen = await release({ defaultSince: dateTime.nowISOString() });
      await quests(chosen.id, 1, 3);

      const value = await resolve("releaseOutlook");

      expect(value.detail.tag).toBe(chosen.tag);
      expect(value.value).toBe(25);
      expect(value.segments?.map((it) => it.value)).toEqual([1, 0, 3]);
      expect(value.link?.params?.releaseTag).toBe(chosen.tag);
    });

    it("falls back to the nearest target date, and reports the pace", async ({
      expect,
    }) => {
      const later = await release({
        targetDate: dateTime.now().add(720, "hour").toISOString(),
      });
      await quests(later.id, 0, 1);
      const sooner = await release({
        targetDate: dateTime.now().add(96, "hour").toISOString(),
      });
      await quests(sooner.id, 7, 6);

      const value = await resolve("releaseOutlook");

      expect(value.detail.tag).toBe(sooner.tag);
      expect(value.detail.daysLeft).toBe(4);
      // Six left over four days; seven done over the 14-day window.
      expect(value.detail.neededPerDay).toBe(1.5);
      expect(value.detail.doingPerDay).toBe(0.5);
    });
  });

  describe("releasesToPublish", () => {
    it("lists the open releases whose every quest is done", async ({
      expect,
    }) => {
      const done = await release();
      await quests(done.id, 2, 0);
      const busy = await release();
      await quests(busy.id, 1, 1);
      await release({ releasedAt: dateTime.nowISOString() });

      const value = await resolve("releasesToPublish");

      expect(value.value).toBe(1);
      expect(value.rows?.map((row) => row.id)).toEqual([done.tag]);
    });
  });

  describe("epics", () => {
    it("lists the epics in progress with their bar, and the drafts apart", async ({
      expect,
    }) => {
      const flying = await createTestEpic(alepha, project, {
        status: "in_progress",
      });
      await createTestQuest(alepha, project, {
        epicId: flying.id,
        completedAt: dateTime.nowISOString(),
      });
      await createTestQuest(alepha, project, { epicId: flying.id });
      const draft = await createTestEpic(alepha, project, { status: "draft" });

      const inFlight = await resolve("epicsInFlight");
      const drafts = await resolve("draftEpics");

      expect(inFlight.rows).toMatchObject([
        { id: `E${flying.number}`, progress: 50 },
      ]);
      expect(drafts.rows?.map((row) => row.id)).toEqual([`E${draft.number}`]);
    });

    it("answers noEpic with no epic of that status", async ({ expect }) => {
      expect((await resolve("epicsInFlight")).empty).toBe("noEpic");
      expect((await resolve("draftEpics")).empty).toBe("noEpic");
    });
  });

  describe("the headline and plan slots", () => {
    it("puts the release with work in the headline", async ({ expect }) => {
      const open = await release();
      await quests(open.id, 1, 2);

      expect(await board()).toContainEqual(["headline", "releaseOutlook"]);
    });

    it("puts the releases ready to publish in the headline, and not again in plan", async ({
      expect,
    }) => {
      const done = await release();
      await quests(done.id, 24, 0);
      await createTestEpic(alepha, project, { status: "draft" });

      const slots = await board();

      expect(slots).toContainEqual(["headline", "releasesToPublish"]);
      expect(slots).toContainEqual(["plan", "draftEpics"]);
      expect(
        slots.filter(([, metric]) => metric === "releasesToPublish"),
      ).toHaveLength(1);
    });

    it("offers no epic or release tile to a project with both on and none of either", async ({
      expect,
    }) => {
      const slots = await board();

      expect(slots.some(([slot]) => slot === "headline")).toBe(false);
      expect(slots.some(([slot]) => slot === "plan")).toBe(false);
    });

    it("never computes an epic tile with the epics option off", async ({
      expect,
    }) => {
      const narrow = await createTestProject(alepha, {
        capabilities: [{ key: "work", options: { releases: true } }],
      });
      await createTestMember(alepha, narrow, narrow.createdBy!);
      await createTestEpic(alepha, narrow, { status: "in_progress" });
      project = narrow;
      user = { id: narrow.createdBy!, roles: ["user"] };

      const slots = await board();

      expect(slots.some(([, metric]) => metric?.includes("pic"))).toBe(false);
    });
  });
});
