import { ProjectController, ProjectDashboardController } from "@lore/core/api";
import { projectDashboardCards, projectDashboards } from "@lore/core/schemas";
import { createPresetRanks } from "@lore/core/testing";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestMemberByProjectId,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

class DashboardsRepositories extends TestEntityRepositories {
  boardCards = $repository(projectDashboardCards);
  dashboards = $repository(projectDashboards);
}

const token = (id: string): UserAccountToken => ({ id, roles: ["user"] });

/**
 * A project holds several dashboards (#E127, #Q3299), through the real
 * controller so the `project:read` and `project:update` gates run.
 */
describe("project dashboards", () => {
  let alepha: Alepha;
  let repos: DashboardsRepositories;
  let board: ProjectDashboardController;
  let owner: UserAccountToken;
  let projectId: number;

  const createProject = async (user: UserAccountToken) => {
    const created = await alepha
      .inject(ProjectController)
      .createProject.fetch(
        { body: { title: `Boards ${crypto.randomUUID().slice(0, 8)}` } },
        { user },
      );
    await createPresetRanks(alepha, created.data.id);
    return created.data.id;
  };

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    bootLore(alepha);
    repos = alepha.inject(DashboardsRepositories);
    await alepha.start();
    board = alepha.inject(ProjectDashboardController);

    owner = token(crypto.randomUUID());
    await repos.users.create({ id: owner.id });
    projectId = await createProject(owner);

    // Something for the computed board to show: a held quest.
    const project = await repos.projects.getOne({
      where: { id: { eq: projectId } },
    });
    await createTestQuest(alepha, project, {
      heldAt: alepha.inject(DateTimeProvider).nowISOString(),
    });
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const load = async (dashboard?: string, user: UserAccountToken = owner) =>
    (
      await board.getProjectDashboard.fetch(
        { params: { projectId }, query: { dashboard } },
        { user },
      )
    ).data;

  const create = async (name: string, user: UserAccountToken = owner) =>
    (
      await board.createProjectDashboard.fetch(
        { params: { projectId }, body: { name } },
        { user },
      )
    ).data;

  const list = async (user: UserAccountToken = owner) =>
    (
      await board.listProjectDashboards.fetch(
        { params: { projectId } },
        { user },
      )
    ).data.dashboards;

  const addCard = (dashboardId?: number) =>
    board.addProjectDashboardCard.fetch(
      {
        params: { projectId },
        query: { dashboardId },
        body: {
          metric: "activeQuests",
          scope: { kind: "projects", projectIds: [projectId] },
        },
      },
      { user: owner },
    );

  it("lists the implicit first, then every dashboard in creation order", async ({
    expect,
  }) => {
    expect(await list()).toEqual([{ position: 0, first: true }]);

    const apps = await create("Apps");
    const work = await create("Work");
    expect(apps).toMatchObject({ name: "Apps", slug: "apps", first: false });

    const all = await list();
    expect(all.map((it) => it.name)).toEqual([undefined, "Apps", "Work"]);
    expect(all.map((it) => it.position)).toEqual([0, 1, 2]);
    expect(all.map((it) => it.first)).toEqual([true, false, false]);
    expect(all[1]!.id).toBe(apps.id);
    expect(all[2]!.id).toBe(work.id);

    // The page read carries the same list, and which one it served.
    const page = await load("work");
    expect(page.dashboard.id).toBe(work.id);
    expect(page.dashboards.map((it) => it.slug)).toEqual([
      undefined,
      "apps",
      "work",
    ]);
  });

  it("gates every write on project:update, and lets a reader list", async ({
    expect,
  }) => {
    const reader = token(crypto.randomUUID());
    await repos.users.create({ id: reader.id });
    await createTestMemberByProjectId(alepha, projectId, reader.id, {
      rank: "contributor",
    });
    const apps = await create("Apps");

    expect((await list(reader)).length).toBe(2);
    expect((await load("apps", reader)).dashboard.id).toBe(apps.id);
    await expect(create("Mine", reader)).rejects.toThrow();
    await expect(
      board.renameProjectDashboard.fetch(
        {
          params: { projectId },
          query: { dashboardId: apps.id },
          body: { name: "Theirs" },
        },
        { user: reader },
      ),
    ).rejects.toThrow();
    await expect(
      board.deleteProjectDashboard.fetch(
        { params: { projectId }, query: { dashboardId: apps.id } },
        { user: reader },
      ),
    ).rejects.toThrow();
    expect((await list()).length).toBe(2);
  });

  it("derives a slug unique in the project, moves it on a rename, and refuses a taken one by name", async ({
    expect,
  }) => {
    const apps = await create("Élan Apps");
    expect(apps.slug).toBe("elan-apps");

    await expect(create("elan apps")).rejects.toThrow(/"Élan Apps"/);
    // Reserved for the fallback.
    await expect(create("Dashboard 3")).rejects.toThrow(/reserved/);

    const nothing = await create("日本語");
    expect(nothing.slug).toBe(`dashboard-${nothing.id}`);
    expect((await load(`dashboard-${nothing.id}`)).dashboard.id).toBe(
      nothing.id,
    );

    const renamed = (
      await board.renameProjectDashboard.fetch(
        {
          params: { projectId },
          query: { dashboardId: apps.id },
          body: { name: "Shop" },
        },
        { user: owner },
      )
    ).data;
    expect(renamed.slug).toBe("shop");
    expect((await load("shop")).dashboard.id).toBe(apps.id);
    // The old slug is not kept.
    await expect(load("elan-apps")).rejects.toThrow(/Dashboard not found/);

    // A rename onto another's slug is refused by that one's name.
    await expect(
      board.renameProjectDashboard.fetch(
        {
          params: { projectId },
          query: { dashboardId: nothing.id },
          body: { name: "shop" },
        },
        { user: owner },
      ),
    ).rejects.toThrow(/"Shop"/);

    // Renaming the implicit first creates its row, still first.
    const first = (
      await board.renameProjectDashboard.fetch(
        { params: { projectId }, body: { name: "Work" } },
        { user: owner },
      )
    ).data;
    expect(first).toMatchObject({ name: "Work", slug: "work", first: true });
    expect((await list())[0]!.id).toBe(first.id);
  });

  it("answers 404 for a dashboard of another project", async ({ expect }) => {
    const stranger = token(crypto.randomUUID());
    await repos.users.create({ id: stranger.id });
    const otherId = await createProject(stranger);
    const theirs = (
      await board.createProjectDashboard.fetch(
        { params: { projectId: otherId }, body: { name: "Secret" } },
        { user: stranger },
      )
    ).data;

    await expect(load("secret")).rejects.toThrow(/Dashboard not found/);
    await expect(addCard(theirs.id)).rejects.toThrow(/Dashboard not found/);
    await expect(
      board.listProjectDashboardCards.fetch(
        { params: { projectId }, query: { dashboardId: theirs.id } },
        { user: owner },
      ),
    ).rejects.toThrow(/Dashboard not found/);
    await expect(
      board.deleteProjectDashboard.fetch(
        { params: { projectId }, query: { dashboardId: theirs.id } },
        { user: owner },
      ),
    ).rejects.toThrow(/Dashboard not found/);
    expect(
      await repos.dashboards.findMany({
        where: { projectId: { eq: otherId } },
      }),
    ).toHaveLength(2);
  });

  it("deletes a dashboard with its cards, and never the last one", async ({
    expect,
  }) => {
    // The implicit first is the last one.
    await expect(
      board.deleteProjectDashboard.fetch(
        { params: { projectId } },
        { user: owner },
      ),
    ).rejects.toThrow(/last dashboard/);

    const apps = await create("Apps");
    await addCard(apps.id);
    await addCard(apps.id);
    const kept = await addCard();

    const deleted = (
      await board.deleteProjectDashboard.fetch(
        { params: { projectId }, query: { dashboardId: apps.id } },
        { user: owner },
      )
    ).data;
    expect(deleted.deletedCards).toBe(2);
    expect(
      (
        await repos.boardCards.findMany({
          where: { projectId: { eq: projectId } },
        })
      ).map((it) => it.id),
    ).toEqual([kept.data.id]);
    expect((await list()).length).toBe(1);

    // Now the first is the last.
    await expect(
      board.deleteProjectDashboard.fetch(
        { params: { projectId } },
        { user: owner },
      ),
    ).rejects.toThrow(/last dashboard/);

    // Deleting the first hands "first" to the next.
    const work = await create("Work");
    await board.deleteProjectDashboard.fetch(
      { params: { projectId } },
      { user: owner },
    );
    const page = await load();
    expect(page.dashboard).toMatchObject({ id: work.id, first: true });
    expect(
      await repos.boardCards.findMany({
        where: { projectId: { eq: projectId } },
      }),
    ).toEqual([]);
  });

  it("computes only the first dashboard, and refuses customize elsewhere", async ({
    expect,
  }) => {
    const first = await load();
    expect(first.computed).toBe(true);
    expect(first.cards.length).toBeGreaterThan(0);

    const apps = await create("Apps");
    const empty = await load("apps");
    expect(empty).toMatchObject({ computed: false, cards: [], values: [] });
    expect(empty.dormantSince).toBeUndefined();
    expect(empty.dashboard).toMatchObject({ id: apps.id, first: false });

    await expect(
      board.customizeProjectDashboard.fetch(
        { params: { projectId }, query: { dashboardId: apps.id } },
        { user: owner },
      ),
    ).rejects.toThrow(/Only the first dashboard/);

    // Card routes act on the dashboard named, and the first by default.
    const card = await addCard(apps.id);
    expect((await load("apps")).cards.map((it) => it.id)).toEqual([
      card.data.id,
    ]);
    expect((await load()).computed).toBe(true);
    const resolved = await board.resolveProjectDashboardCards.fetch(
      { params: { projectId }, query: { dashboardId: apps.id }, body: {} },
      { user: owner },
    );
    expect(resolved.data.values.map((it) => it.cardId)).toEqual([card.data.id]);
    const second = await addCard(apps.id);
    const ordered = await board.reorderProjectDashboardCards.fetch(
      {
        params: { projectId },
        query: { dashboardId: apps.id },
        body: { ids: [second.data.id, card.data.id] },
      },
      { user: owner },
    );
    expect(ordered.data.cards.map((it) => it.id)).toEqual([
      second.data.id,
      card.data.id,
    ]);

    // Reset empties the dashboard named, which stays empty.
    await board.resetProjectDashboard.fetch(
      { params: { projectId }, query: { dashboardId: apps.id } },
      { user: owner },
    );
    expect(await load("apps")).toMatchObject({ computed: false, cards: [] });

    // Customize on the first, with the first still implicit, creates its row.
    const made = await board.customizeProjectDashboard.fetch(
      { params: { projectId } },
      { user: owner },
    );
    const firstRow = (await list())[0]!;
    expect(firstRow.id).toBeDefined();
    const stored = await repos.boardCards.findMany({
      where: { projectId: { eq: projectId } },
    });
    expect(stored.map((it) => it.dashboardId)).toEqual(
      made.data.cards.map(() => firstRow.id),
    );
  });
});
