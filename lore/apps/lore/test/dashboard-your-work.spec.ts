import {
  DashboardMetricRegistry,
  DashboardScopeService,
  ProjectDashboardController,
} from "@lore/core/api";
import type {
  DashboardCardValue,
  DashboardScope,
  Project,
} from "@lore/core/schemas";
import { projectDashboardCards } from "@lore/core/schemas";
import { ReadCounter } from "@lore/core/testing";
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
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

class YourWorkRepositories extends TestEntityRepositories {
  boardCards = $repository(projectDashboardCards);
}

/**
 * The "your work" tiles of #E77 (#Q2655): a `viewer` scope resolved against
 * whoever reads the board, never stored with an id.
 */
describe("dashboard your work", () => {
  let alepha: Alepha;
  let repos: YourWorkRepositories;
  let registry: DashboardMetricRegistry;
  let dateTime: DateTimeProvider;
  let project: Project;
  let ana: UserAccountToken;
  let ben: UserAccountToken;

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
    repos = alepha.inject(YourWorkRepositories);
    await alepha.start();
    registry = alepha.inject(DashboardMetricRegistry);
    dateTime = alepha.inject(DateTimeProvider);
    project = await createTestProject(alepha);
    await createTestMember(alepha, project, project.createdBy!);
    ana = { id: project.createdBy!, roles: ["user"] };
    const other = await repos.users.create({});
    await createTestMember(alepha, project, other.id);
    ben = { id: other.id, roles: ["user"] };
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const resolve = async (
    metric: string,
    scope: DashboardScope,
    user: UserAccountToken = ana,
  ): Promise<DashboardCardValue> =>
    (
      await registry.resolveForProject(
        [{ id: 1, metric, scope, filters: {}, size: 1, position: 0 }],
        user,
        project,
      )
    )[0]!;

  const viewer: DashboardScope = { kind: "viewer" };

  describe("the viewer scope", () => {
    it("refuses a viewer scope carrying a payload", ({ expect }) => {
      expect(() =>
        alepha
          .inject(DashboardScopeService)
          .assertWellFormed({ kind: "viewer", projectIds: [project.id] }),
      ).toThrow(/must not carry/);
    });

    it("shows two readers of the same board their own quests", async ({
      expect,
    }) => {
      await createTestQuest(alepha, project, {
        title: "Ana's quest",
        acceptedBy: ana.id,
        acceptedAt: dateTime.nowISOString(),
      });
      await createTestQuest(alepha, project, {
        title: "Ben's quest",
        acceptedBy: ben.id,
        acceptedAt: dateTime.nowISOString(),
      });

      const forAna = await resolve("yourQuests", viewer, ana);
      const forBen = await resolve("yourQuests", viewer, ben);

      expect(forAna.rows?.map((row) => row.title)).toEqual(["Ana's quest"]);
      expect(forBen.rows?.map((row) => row.title)).toEqual(["Ben's quest"]);
    });

    it("stores a viewer card with no user id in it", async ({ expect }) => {
      const board = alepha.inject(ProjectDashboardController);
      await board.addProjectDashboardCard.fetch(
        {
          params: { projectId: project.id },
          body: { metric: "yourQuests", scope: viewer },
        },
        { user: ana },
      );

      const [row] = await repos.boardCards.findMany({
        where: { projectId: { eq: project.id } },
      });

      expect(row?.scope).toEqual({ kind: "viewer" });
    });

    it("answers noQuests to a reader who holds none", async ({ expect }) => {
      expect((await resolve("yourQuests", viewer, ben)).empty).toBe("noQuests");
    });
  });

  describe("reminders and due dates", () => {
    it("lists the reader's reminders due within seven days", async ({
      expect,
    }) => {
      await createTestQuest(alepha, project, {
        title: "soon",
        acceptedBy: ana.id,
        acceptedAt: dateTime.nowISOString(),
        reminderInterval: "weekly",
        reminderNextAt: dateTime.now().add(2, "day").toISOString(),
      });
      await createTestQuest(alepha, project, {
        title: "later",
        acceptedBy: ana.id,
        acceptedAt: dateTime.nowISOString(),
        reminderInterval: "monthly",
        reminderNextAt: dateTime.now().add(20, "day").toISOString(),
      });

      const value = await resolve("remindersDue", viewer);

      expect(value.rows?.map((row) => row.title)).toEqual(["soon"]);
    });

    it("lists due quests with the overdue first", async ({ expect }) => {
      await createTestQuest(alepha, project, {
        title: "tomorrow",
        dueAt: dateTime.now().add(1, "day").toISOString(),
      });
      await createTestQuest(alepha, project, {
        title: "late",
        dueAt: dateTime.now().subtract(1, "day").toISOString(),
      });

      const value = await resolve("dueSoon", {
        kind: "projects",
        projectIds: [project.id],
      });

      expect(value.rows?.map((row) => [row.title, row.badge])).toEqual([
        ["late", "overdue"],
        ["tomorrow", "dueSoon"],
      ]);
    });
  });

  describe("recentlyShipped", () => {
    it("feeds the last completions with their message's first line", async ({
      expect,
    }) => {
      await createTestQuest(alepha, project, {
        title: "Shipped",
        completedAt: dateTime.nowISOString(),
        completionMessage: "\nMoved the board to slots.\nMore detail.",
      });

      const value = await resolve("recentlyShipped", {
        kind: "projects",
        projectIds: [project.id],
      });

      expect(value.rows?.[0]).toMatchObject({
        title: "Shipped",
        excerpt: "Moved the board to slots.",
      });
    });
  });

  describe("the your-work slot", () => {
    it("fills for a reader with a quest, and stays away for one without", async ({
      expect,
    }) => {
      await createTestQuest(alepha, project, {
        acceptedBy: ana.id,
        acceptedAt: dateTime.nowISOString(),
      });
      const board = alepha.inject(ProjectDashboardController);
      const load = async (user: UserAccountToken) =>
        (
          await board.getProjectDashboard.fetch(
            { params: { projectId: project.id } },
            { user },
          )
        ).data.cards.map((card) => [card.slot, card.metric]);

      expect(await load(ana)).toContainEqual(["yourWork", "yourQuests"]);
      expect((await load(ben)).some(([slot]) => slot === "yourWork")).toBe(
        false,
      );
    });
  });
});
