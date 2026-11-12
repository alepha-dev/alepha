import { ProjectController, ProjectDashboardController } from "@lore/core/api";
import type { DashboardScope, ReportsQuery } from "@lore/core/schemas";
import { createPresetRanks } from "@lore/core/testing";
import { ProjectReportsService } from "@lore/work/api";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

/**
 * The reports a board reads, counted per call: the measure #Q3490 is judged
 * on is how many times one board reads a series, not what it adds up to.
 */
class CountingReports extends ProjectReportsService {
  public readonly calls = new Map<string, number>();

  protected count(name: string): void {
    this.calls.set(name, (this.calls.get(name) ?? 0) + 1);
  }

  override async completedByDay(projectId: number, query: ReportsQuery) {
    this.count("completedByDay");
    return super.completedByDay(projectId, query);
  }

  override async createdByDay(projectId: number, query: ReportsQuery) {
    this.count("createdByDay");
    return super.createdByDay(projectId, query);
  }

  override async overview(projectId: number, query: ReportsQuery) {
    this.count("overview");
    return super.overview(projectId, query);
  }

  override async questsReport(projectId: number, query: ReportsQuery) {
    this.count("questsReport");
    return super.questsReport(projectId, query);
  }
}

const token = (id: string): UserAccountToken => ({ id, roles: ["user"] });

/**
 * One board resolution reads each report once (#Q3490): the flow tiles share
 * `completedByDay`, and Cycle time reads its median rather than a whole page.
 */
describe("dashboard shared reads", () => {
  let alepha: Alepha;
  let repos: TestEntityRepositories;
  let board: ProjectDashboardController;
  let reports: CountingReports;
  let dateTime: DateTimeProvider;
  let owner: UserAccountToken;
  let projectId: number;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with({ provide: ProjectReportsService, use: CountingReports });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    bootLore(alepha);
    repos = alepha.inject(TestEntityRepositories);
    await alepha.start();
    board = alepha.inject(ProjectDashboardController);
    reports = alepha.inject(ProjectReportsService) as CountingReports;
    dateTime = alepha.inject(DateTimeProvider);

    owner = token(crypto.randomUUID());
    await repos.users.create({ id: owner.id });
    const created = await alepha
      .inject(ProjectController)
      .createProject.fetch(
        { body: { title: `Shared ${crypto.randomUUID().slice(0, 8)}` } },
        { user: owner },
      );
    projectId = created.data.id;
    await createPresetRanks(alepha, projectId);
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const complete = async (
    days: number,
    priority: "low" | "medium" | "high" = "medium",
  ) => {
    const project = await repos.projects.getOne({
      where: { id: { eq: projectId } },
    });
    const completedAt = dateTime.now().subtract(days, "day").toISOString();
    const acceptedAt = dateTime
      .now()
      .subtract(days + 1, "day")
      .toISOString();
    await createTestQuest(alepha, project, {
      acceptedAt,
      completedAt,
      priority,
    });
  };

  const add = async (metric: string, filters: Record<string, unknown> = {}) => {
    const scope: DashboardScope = { kind: "projects", projectIds: [projectId] };
    await board.addProjectDashboardCard.fetch(
      { params: { projectId }, body: { metric, scope, filters } },
      { user: owner },
    );
  };

  const load = async () => {
    reports.calls.clear();
    return (
      await board.getProjectDashboard.fetch(
        { params: { projectId } },
        { user: owner },
      )
    ).data;
  };

  describe("the flow tiles", () => {
    it("read completedByDay once between four tiles", async ({ expect }) => {
      await complete(1);
      await complete(3);
      for (const metric of [
        "burnup",
        "completedThisWeek",
        "completedPerWeek",
        "boardColumns",
      ]) {
        await add(metric);
      }

      const loaded = await load();

      expect(loaded.values.every((value) => value.ok)).toBe(true);
      expect(reports.calls.get("completedByDay")).toBe(1);
      expect(reports.calls.get("createdByDay")).toBe(1);
    });

    it("read again on the next load, never across requests", async ({
      expect,
    }) => {
      await add("completedThisWeek");
      await add("burnup");

      const before = await load();
      await complete(1);
      const after = await load();

      const thisWeek = (data: typeof before) =>
        data.values.find(
          (value) =>
            value.cardId ===
            data.cards.find((card) => card.metric === "completedThisWeek")!.id,
        )!.value;
      expect(thisWeek(before)).toBe(0);
      expect(thisWeek(after)).toBe(1);
      expect(reports.calls.get("completedByDay")).toBe(1);
    });
  });

  describe("cycle time", () => {
    it("reads neither the Overview nor the Quests page", async ({ expect }) => {
      await complete(1);
      await add("cycleTime");
      await add("cycleTime", { priority: "high" });

      await load();

      expect(reports.calls.get("overview")).toBeUndefined();
      expect(reports.calls.get("questsReport")).toBeUndefined();
    });

    it("agrees with the Quests page for one priority", async ({ expect }) => {
      await complete(1, "high");
      await complete(4, "high");
      await complete(2, "low");
      await add("cycleTime", { priority: "high" });

      const loaded = await load();
      const page = await reports.questsReport(projectId, {});

      const expected = page.cycleTimeByPriority.find(
        (row) => row.priority === "high",
      )!.medianHours;
      expect(loaded.values[0]!.value).toBe(Math.round(expected));
      expect(expected).toBeGreaterThan(0);
    });

    it("answers zero for a priority with no completed quest", async ({
      expect,
    }) => {
      await complete(1, "low");
      await add("cycleTime", { priority: "high" });

      const loaded = await load();

      expect(loaded.values[0]!.value).toBe(0);
      expect(loaded.values[0]!.empty).toBe("noData");
    });
  });
});
