import { ProjectController, ProjectDashboardController } from "@lore/core/api";
import type { DashboardCardValue, DashboardScope } from "@lore/core/schemas";
import { projectCapabilities } from "@lore/core/schemas";
import { createPresetRanks } from "@lore/core/testing";
import { ProjectReportsController } from "@lore/work/api";
import { Alepha } from "alepha";
import { RankService } from "alepha/api/organizations";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { $repository } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestMemberByProjectId,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

class FlowRepositories extends TestEntityRepositories {
  capabilities = $repository(projectCapabilities);
}

const token = (id: string): UserAccountToken => ({ id, roles: ["user"] });

/**
 * The flow tiles of #E77 (#Q2653): Reports numbers as dashboard metrics,
 * reading the Reports queries so the two agree, gated on `stats:read`.
 * Driven through the real controllers, so the `$ownsProject` gates run.
 */
describe("dashboard flow tiles", () => {
  let alepha: Alepha;
  let repos: FlowRepositories;
  let board: ProjectDashboardController;
  let reports: ProjectReportsController;
  let dateTime: DateTimeProvider;
  let owner: UserAccountToken;
  let projectId: number;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    bootLore(alepha);
    repos = alepha.inject(FlowRepositories);
    await alepha.start();
    board = alepha.inject(ProjectDashboardController);
    reports = alepha.inject(ProjectReportsController);
    dateTime = alepha.inject(DateTimeProvider);

    owner = token(crypto.randomUUID());
    await repos.users.create({ id: owner.id });
    const created = await alepha
      .inject(ProjectController)
      .createProject.fetch(
        { body: { title: `Flow ${crypto.randomUUID().slice(0, 8)}` } },
        { user: owner },
      );
    projectId = created.data.id;
    await createPresetRanks(alepha, projectId);
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const project = async () =>
    repos.projects.getOne({ where: { id: { eq: projectId } } });

  const quest = async (overrides: Record<string, unknown> = {}) =>
    createTestQuest(alepha, await project(), overrides);

  const completeDaysAgo = async (days: number, count = 1) => {
    for (let i = 0; i < count; i += 1) {
      const at = dateTime.now().subtract(days, "day").toISOString();
      await quest({ acceptedAt: at, completedAt: at, area: "api" });
    }
  };

  /**
   * One stored card, resolved through the page's own endpoint.
   */
  const resolve = async (
    metric: string,
    filters: Record<string, unknown> = {},
    user: UserAccountToken = owner,
  ): Promise<DashboardCardValue> => {
    const scope: DashboardScope = { kind: "projects", projectIds: [projectId] };
    await board.addProjectDashboardCard.fetch(
      { params: { projectId }, body: { metric, scope, filters } },
      { user: owner },
    );
    const loaded = await board.getProjectDashboard.fetch(
      { params: { projectId } },
      { user },
    );
    const cards = loaded.data.cards.filter((it) => it.metric === metric);
    return loaded.data.values.find(
      (value) => value.cardId === cards[cards.length - 1]!.id,
    )!;
  };

  describe("agreement with Reports", () => {
    it("counts this week's completions as the Overview KPI does, with a delta", async ({
      expect,
    }) => {
      await completeDaysAgo(1, 3);
      await completeDaysAgo(9, 2);

      const value = await resolve("completedThisWeek");
      const overview = await reports.getReportsOverview.fetch(
        { params: { id: projectId } },
        { user: owner },
      );

      expect(value.value).toBe(overview.data.kpis.completedThisWeek);
      expect(value.detail.lastWeek).toBe(overview.data.kpis.completedLastWeek);
      expect(value.delta).toBe(50);
      expect(value.series).toHaveLength(14);
    });

    it("draws the burn-up to the same completed total Reports reaches", async ({
      expect,
    }) => {
      await quest();
      await completeDaysAgo(2, 2);

      const value = await resolve("burnup");
      const overview = await reports.getReportsOverview.fetch(
        { params: { id: projectId } },
        { user: owner },
      );
      const last = overview.data.burnup[overview.data.burnup.length - 1]!;

      expect(value.value).toBe(last.completed);
      expect(value.detail.created).toBe(last.created);
    });

    it("reads cycle time from the Overview KPI", async ({ expect }) => {
      await completeDaysAgo(1);

      const value = await resolve("cycleTime");
      const overview = await reports.getReportsOverview.fetch(
        { params: { id: projectId } },
        { user: owner },
      );

      expect(value.value).toBe(
        Math.round(overview.data.kpis.avgCycleTimeHours),
      );
    });

    it("breaks quests down by area as the Quests tab does", async ({
      expect,
    }) => {
      await completeDaysAgo(1, 2);
      await quest({ area: "ui" });

      const value = await resolve("questBreakdown", { by: "area" });
      const tab = await reports.getReportsQuests.fetch(
        { params: { id: projectId } },
        { user: owner },
      );

      expect(value.segments).toEqual(
        tab.data.byArea.map((row) => ({
          label: row.area,
          value: row.completed + row.remaining,
        })),
      );
    });

    it("weekly bars sum to the last eight weeks of completions", async ({
      expect,
    }) => {
      await completeDaysAgo(1, 2);
      await completeDaysAgo(20, 3);
      await completeDaysAgo(80, 4);

      const value = await resolve("completedPerWeek");

      expect(value.series).toHaveLength(8);
      expect(value.value).toBe(5);
    });
  });

  describe("board columns", () => {
    it("places open quests in their lane and leaves completed out", async ({
      expect,
    }) => {
      // The board is a Work option, off on a new project.
      await repos.capabilities.updateMany(
        { projectId: { eq: projectId }, key: { eq: "work" } },
        { options: { board: true } },
      );
      await quest();
      await quest({ acceptedAt: dateTime.nowISOString() });
      await completeDaysAgo(1);

      const value = await resolve("boardColumns");

      expect(value.value).toBe(2);
      expect(
        Object.fromEntries(
          (value.rows ?? []).map((row) => [row.id ?? row.badge, row.value]),
        ),
      ).toMatchObject({ todo: 1 });
      expect(
        (value.rows ?? []).reduce((n, row) => n + (row.value ?? 0), 0),
      ).toBe(2);
    });
  });

  describe("gates", () => {
    it("answers noAccess to a member without stats:read", async ({
      expect,
    }) => {
      const reader = token(crypto.randomUUID());
      await repos.users.create({ id: reader.id });
      const organizationId = (await project()).organizationId!;
      await alepha.context.run(() =>
        alepha.inject(RankService).save(
          organizationId,
          {
            key: "no-stats",
            name: "No stats",
            permissions: ["project:read", "quest:read"],
          },
          owner,
        ),
      );
      await createTestMemberByProjectId(alepha, projectId, reader.id, {
        rank: "no-stats",
      });

      const value = await resolve("completedThisWeek", {}, reader);

      expect(value.empty).toBe("noAccess");
      expect(value.value).toBeUndefined();
    });

    it("keeps the flow slot of the computed board below five completions empty of Reports tiles", async ({
      expect,
    }) => {
      await completeDaysAgo(1, 3);
      await quest();

      const loaded = await board.getProjectDashboard.fetch(
        { params: { projectId } },
        { user: owner },
      );
      const flow = loaded.data.cards.find((card) => card.slot === "flow");

      expect(loaded.data.computed).toBe(true);
      expect(flow?.metric).toBe("activeQuests");
    });

    it("fills the flow slot with a Reports tile from five completions", async ({
      expect,
    }) => {
      await completeDaysAgo(1, 5);
      await quest();

      const loaded = await board.getProjectDashboard.fetch(
        { params: { projectId } },
        { user: owner },
      );
      const flow = loaded.data.cards.find((card) => card.slot === "flow");

      expect(["boardColumns", "completedPerWeek", "burnup"]).toContain(
        flow?.metric,
      );
    });
  });
});
