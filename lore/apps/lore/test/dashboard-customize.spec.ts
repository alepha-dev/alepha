import { ProjectController, ProjectDashboardController } from "@lore/core/api";
import { projectDashboardCards } from "@lore/core/schemas";
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

class CustomizeRepositories extends TestEntityRepositories {
  boardCards = $repository(projectDashboardCards);
}

const token = (id: string): UserAccountToken => ({ id, roles: ["user"] });

/**
 * Customize and Reset to default (#E77, #Q2660), through the real controller
 * so the `project:update` gate runs.
 */
describe("dashboard customize and reset", () => {
  let alepha: Alepha;
  let repos: CustomizeRepositories;
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
    repos = alepha.inject(CustomizeRepositories);
    await alepha.start();
    board = alepha.inject(ProjectDashboardController);

    owner = token(crypto.randomUUID());
    await repos.users.create({ id: owner.id });
    const created = await alepha
      .inject(ProjectController)
      .createProject.fetch(
        { body: { title: `Custom ${crypto.randomUUID().slice(0, 8)}` } },
        { user: owner },
      );
    projectId = created.data.id;
    await createPresetRanks(alepha, projectId);

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

  const load = async (user: UserAccountToken = owner) =>
    (await board.getProjectDashboard.fetch({ params: { projectId } }, { user }))
      .data;

  it("copies the tiles the computed board renders, in order, once", async ({
    expect,
  }) => {
    const before = await load();
    expect(before.computed).toBe(true);

    const made = await board.customizeProjectDashboard.fetch(
      { params: { projectId } },
      { user: owner },
    );
    const after = await load();

    expect(made.data.cards.map((card) => card.metric)).toEqual(
      before.cards.map((card) => card.metric),
    );
    expect(after.computed).toBe(false);
    expect(
      after.cards.map((card) => [card.metric, card.size, card.height]),
    ).toEqual(
      before.cards.map((card) => [card.metric, card.size, card.height ?? 1]),
    );
    // Stored cards belong to no slot.
    expect(after.cards.every((card) => card.slot === undefined)).toBe(true);
  });

  it("refuses a second customize rather than doubling the board", async ({
    expect,
  }) => {
    await board.customizeProjectDashboard.fetch(
      { params: { projectId } },
      { user: owner },
    );

    await expect(
      board.customizeProjectDashboard.fetch(
        { params: { projectId } },
        { user: owner },
      ),
    ).rejects.toThrow(/already customized/);
  });

  it("resets to the computed board by deleting every stored card", async ({
    expect,
  }) => {
    await board.customizeProjectDashboard.fetch(
      { params: { projectId } },
      { user: owner },
    );

    await board.resetProjectDashboard.fetch(
      { params: { projectId } },
      { user: owner },
    );

    expect(
      await repos.boardCards.findMany({
        where: { projectId: { eq: projectId } },
      }),
    ).toEqual([]);
    expect((await load()).computed).toBe(true);
  });

  it("refuses both to a member without project:update", async ({ expect }) => {
    const reader = token(crypto.randomUUID());
    await repos.users.create({ id: reader.id });
    await createTestMemberByProjectId(alepha, projectId, reader.id, {
      rank: "contributor",
    });

    await expect(
      board.customizeProjectDashboard.fetch(
        { params: { projectId } },
        { user: reader },
      ),
    ).rejects.toThrow();
    await expect(
      board.resetProjectDashboard.fetch(
        { params: { projectId } },
        { user: reader },
      ),
    ).rejects.toThrow();
    expect((await load(reader)).computed).toBe(true);
  });
});
