import { ProjectController, ProjectDashboardController } from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import { TestEntityRepositories } from "./fixtures/entities.ts";

const token = (id: string): UserAccountToken => ({ id, roles: ["user"] });

/**
 * One time window for the whole board (#E77, #Q2661): the reader's 7, 14 or
 * 30 days reach every tile of the one resolve.
 */
describe("dashboard time window", () => {
  let alepha: Alepha;
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
    const repos = alepha.inject(TestEntityRepositories);
    await alepha.start();
    board = alepha.inject(ProjectDashboardController);
    owner = token(crypto.randomUUID());
    await repos.users.create({ id: owner.id });
    const created = await alepha
      .inject(ProjectController)
      .createProject.fetch(
        { body: { title: `Window ${crypto.randomUUID().slice(0, 8)}` } },
        { user: owner },
      );
    projectId = created.data.id;
    await createPresetRanks(alepha, projectId);
  });

  afterEach(async () => {
    await alepha.stop();
  });

  it("draws every tile's series over the reader's window", async ({
    expect,
  }) => {
    await board.addProjectDashboardCard.fetch(
      {
        params: { projectId },
        body: {
          metric: "completedThisWeek",
          scope: { kind: "projects", projectIds: [projectId] },
        },
      },
      { user: owner },
    );

    for (const window of ["7", "14", "30"] as const) {
      const loaded = await board.getProjectDashboard.fetch(
        { params: { projectId }, query: { window } },
        { user: owner },
      );
      expect(loaded.data.values[0]?.series, window).toHaveLength(
        Number(window),
      );
    }
  });

  it("defaults to fourteen days", async ({ expect }) => {
    await board.addProjectDashboardCard.fetch(
      {
        params: { projectId },
        body: {
          metric: "completedThisWeek",
          scope: { kind: "projects", projectIds: [projectId] },
        },
      },
      { user: owner },
    );

    const loaded = await board.getProjectDashboard.fetch(
      { params: { projectId }, query: {} },
      { user: owner },
    );

    expect(loaded.data.values[0]?.series).toHaveLength(14);
  });

  it("refuses a window outside the three", async ({ expect }) => {
    await expect(
      board.getProjectDashboard.fetch(
        { params: { projectId }, query: { window: "90" as never } },
        { user: owner },
      ),
    ).rejects.toThrow();
  });
});
