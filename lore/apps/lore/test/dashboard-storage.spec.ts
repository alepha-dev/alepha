import {
  ProjectController,
  ProjectDashboardCardService,
  ProjectDashboardService,
} from "@lore/core/api";
import { projectDashboardCards, projectDashboards } from "@lore/core/schemas";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import { TestEntityRepositories } from "./fixtures/entities.ts";

class StorageRepositories extends TestEntityRepositories {
  boardCards = $repository(projectDashboardCards);
  dashboards = $repository(projectDashboards);
}

const card = (projectId: number) => ({
  metric: "activeQuests",
  scope: { kind: "projects" as const, projectIds: [projectId] },
});

/**
 * Cards are stored per dashboard (#E127, #Q3298): every list, add, copy,
 * reset and reorder acts on one, and none named means the project's first.
 */
describe("dashboard storage", () => {
  let alepha: Alepha;
  let repos: StorageRepositories;
  let cards: ProjectDashboardCardService;
  let dashboards: ProjectDashboardService;
  let projectId: number;

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
    repos = alepha.inject(StorageRepositories);
    await alepha.start();
    cards = alepha.inject(ProjectDashboardCardService);
    dashboards = alepha.inject(ProjectDashboardService);

    const owner: UserAccountToken = {
      id: crypto.randomUUID(),
      roles: ["user"],
    };
    await repos.users.create({ id: owner.id });
    const created = await alepha
      .inject(ProjectController)
      .createProject.fetch(
        { body: { title: `Storage ${crypto.randomUUID().slice(0, 8)}` } },
        { user: owner },
      );
    projectId = created.data.id;
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const rowsOf = () =>
    repos.dashboards.findMany({ where: { projectId: { eq: projectId } } });

  it("has one implicit first dashboard until a write needs its row", async ({
    expect,
  }) => {
    expect(await cards.list(projectId)).toEqual([]);
    await cards.reset(projectId);
    expect(await rowsOf()).toEqual([]);

    const added = await cards.add(projectId, undefined, card(projectId));
    const rows = await rowsOf();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBeUndefined();
    expect(rows[0]!.slug).toBeUndefined();
    expect(rows[0]!.position).toBe(0);

    const stored = await repos.boardCards.getById(added.id);
    expect(stored.dashboardId).toBe(rows[0]!.id);
  });

  it("reads a card with no dashboard as the first's, and adopts it on a write", async ({
    expect,
  }) => {
    // What the previous Worker writes in the deploy window.
    const orphan = await repos.boardCards.create({
      projectId,
      ...card(projectId),
      position: 0,
    });
    expect((await cards.list(projectId)).map((it) => it.id)).toEqual([
      orphan.id,
    ]);

    // The first exists but the orphan predates it: still read as the first's.
    const first = await repos.dashboards.create({ projectId, position: 0 });
    expect((await cards.list(projectId)).map((it) => it.id)).toEqual([
      orphan.id,
    ]);

    const added = await cards.add(projectId, undefined, card(projectId));
    expect((await repos.boardCards.getById(orphan.id)).dashboardId).toBe(
      first.id,
    );
    expect((await cards.list(projectId)).map((it) => it.id)).toEqual([
      orphan.id,
      added.id,
    ]);
  });

  it("keeps each dashboard's cards apart", async ({ expect }) => {
    const a = await cards.add(projectId, undefined, card(projectId));
    const first = (await dashboards.first(projectId))!;
    const second = await repos.dashboards.create({
      projectId,
      name: "Apps",
      slug: "apps",
      position: 1,
    });

    const b = await cards.add(projectId, second.id, card(projectId));
    const c = await cards.add(projectId, second.id, card(projectId));
    expect(b.position).toBe(0);
    expect(c.position).toBe(1);

    expect((await cards.list(projectId)).map((it) => it.id)).toEqual([a.id]);
    expect((await cards.list(projectId, first.id)).map((it) => it.id)).toEqual([
      a.id,
    ]);
    expect((await cards.list(projectId, second.id)).map((it) => it.id)).toEqual(
      [b.id, c.id],
    );

    // A reorder lists one dashboard's cards, every one exactly once.
    await expect(
      cards.reorder(projectId, second.id, [c.id, b.id, a.id]),
    ).rejects.toThrow(/exactly once/);
    await cards.reorder(projectId, second.id, [c.id, b.id]);
    expect((await cards.list(projectId, second.id)).map((it) => it.id)).toEqual(
      [c.id, b.id],
    );

    // A copy is refused only where cards are already stored.
    await expect(
      cards.copy(projectId, undefined, [
        { ...card(projectId), filters: {}, size: 1 },
      ]),
    ).rejects.toThrow(/already customized/);

    // A reset empties the dashboard named, and no other.
    await cards.reset(projectId, second.id);
    expect(await cards.list(projectId, second.id)).toEqual([]);
    expect((await cards.list(projectId)).map((it) => it.id)).toEqual([a.id]);

    const copied = await cards.copy(projectId, second.id, [
      { ...card(projectId), filters: {}, size: 2 },
    ]);
    expect(copied).toHaveLength(1);
    expect((await repos.boardCards.getById(copied[0]!.id)).dashboardId).toBe(
      second.id,
    );
  });

  it("refuses a dashboard of another project", async ({ expect }) => {
    const other = await repos.projects.create({
      title: "Elsewhere",
      slug: `elsewhere-${crypto.randomUUID().slice(0, 8)}`,
      createdBy: (await repos.users.findMany({ limit: 1 }))[0]!.id,
    } as any);
    const theirs = await repos.dashboards.create({
      projectId: other.id,
      position: 0,
    });
    await expect(cards.list(projectId, theirs.id)).rejects.toThrow(
      /Dashboard not found/,
    );
    await expect(
      cards.add(projectId, theirs.id, card(projectId)),
    ).rejects.toThrow(/Dashboard not found/);
  });
});
