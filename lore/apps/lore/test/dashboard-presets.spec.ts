import { ProjectController, ProjectDashboardController } from "@lore/core/api";
import {
  DashboardMetricCatalog,
  DashboardPresetCatalog,
} from "@lore/core/schemas";
import { createPresetRanks } from "@lore/core/testing";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestMemberByProjectId,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

const token = (id: string): UserAccountToken => ({ id, roles: ["user"] });

/**
 * Dashboard presets (#Q3831): a ready-made layout replaces a board's cards,
 * or starts a new board, through the real controller so the
 * `project:update` gate runs. The project has Plan with releases, and no
 * Ship and no Requirements.
 */
describe("dashboard presets", () => {
  let alepha: Alepha;
  let repos: TestEntityRepositories;
  let board: ProjectDashboardController;
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
    repos = alepha.inject(TestEntityRepositories);
    await alepha.start();
    board = alepha.inject(ProjectDashboardController);

    owner = token(crypto.randomUUID());
    await repos.users.create({ id: owner.id });
    projectId = (
      await alepha.inject(ProjectController).createProject.fetch(
        {
          body: {
            title: `Presets ${crypto.randomUUID().slice(0, 8)}`,
            capabilities: [
              { key: "plan", options: { epics: true, releases: true } },
            ],
          } as never,
        },
        { user: owner },
      )
    ).data.id;
    await createPresetRanks(alepha, projectId);
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const load = async (dashboard?: string) =>
    (
      await board.getProjectDashboard.fetch(
        { params: { projectId }, query: dashboard ? { dashboard } : {} },
        { user: owner },
      )
    ).data;

  it("replaces the board's cards with the preset's, leaving out what the project does not answer", async ({
    expect,
  }) => {
    const made = await board.applyProjectDashboardPreset.fetch(
      { params: { projectId }, body: { preset: "triage" } },
      { user: owner },
    );
    const after = await load();

    const metrics = after.cards.map((card) => card.metric);
    expect(after.computed).toBe(false);
    expect(metrics).toEqual(made.data.cards.map((card) => card.metric));
    expect(metrics).toEqual(
      expect.arrayContaining(["needsYou", "heldQuests", "activityFeed"]),
    );
    // Ship is off: its error card is left out, never stored as unavailable.
    expect(metrics).not.toContain("openErrors");
    expect(
      after.cards.find((card) => card.metric === "needsYou"),
    ).toMatchObject({ size: 2, height: 2 });

    // Applying another one replaces, rather than appends.
    await board.applyProjectDashboardPreset.fetch(
      { params: { projectId }, body: { preset: "delivery" } },
      { user: owner },
    );
    const delivery = DashboardPresetCatalog.find("delivery")!.cards.map(
      (card) => card.metric,
    );
    expect((await load()).cards.map((card) => card.metric)).toEqual(delivery);
  });

  it("names only metrics a project board can place without picking a subject", ({
    expect,
  }) => {
    const catalog = alepha.inject(DashboardMetricCatalog);
    for (const preset of DashboardPresetCatalog.PRESETS) {
      for (const card of preset.cards) {
        const where = `${preset.key}: ${card.metric}`;
        expect(catalog.find(card.metric), where).toBeDefined();
        expect(catalog.offers(card.metric, "project"), where).toBe(true);
        expect(
          catalog.forcedScope(card.metric, "project", 1) !== undefined ||
            catalog.accepts(card.metric, "projects", "project"),
          where,
        ).toBe(true);
      }
    }
  });

  it("refuses a preset whose capability is off, naming what to turn on", async ({
    expect,
  }) => {
    await expect(
      board.applyProjectDashboardPreset.fetch(
        { params: { projectId }, body: { preset: "appVitals" } },
        { user: owner },
      ),
    ).rejects.toThrow(/needs the ship capability/);
    await expect(
      board.applyProjectDashboardPreset.fetch(
        { params: { projectId }, body: { preset: "requirements" } },
        { user: owner },
      ),
    ).rejects.toThrow(/requirements option of plan/);
    expect((await load()).computed).toBe(true);
  });

  it("starts a new dashboard from a preset", async ({ expect }) => {
    const made = await board.createProjectDashboard.fetch(
      { params: { projectId }, body: { name: "Delivery", preset: "delivery" } },
      { user: owner },
    );

    const cards = (await load(made.data.slug)).cards;
    expect(cards.map((card) => card.metric)).toContain("releaseOutlook");
    // The first board is untouched.
    expect((await load()).computed).toBe(true);
  });

  it("is refused to a rank that may not change the project", async ({
    expect,
  }) => {
    const viewer = token(crypto.randomUUID());
    await repos.users.create({ id: viewer.id });
    await createTestMemberByProjectId(alepha, projectId, viewer.id, {
      rank: "viewer",
    });

    await expect(
      board.applyProjectDashboardPreset.fetch(
        { params: { projectId }, body: { preset: "triage" } },
        { user: viewer },
      ),
    ).rejects.toThrow();
  });
});
