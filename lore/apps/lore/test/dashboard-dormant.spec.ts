import { ProjectDashboardController } from "@lore/core/api";
import type { Project } from "@lore/core/schemas";
import { ReadCounter } from "@lore/core/testing";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
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

/**
 * A dormant project's board (#E77, #Q2662): no recorded write in 90 days,
 * so the computed board is one line and what it shipped last.
 */
describe("dashboard dormant state", () => {
  let alepha: Alepha;
  let dateTime: DateTimeProvider;
  let board: ProjectDashboardController;
  let project: Project;
  let user: UserAccountToken;

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
    await alepha.start();
    dateTime = alepha.inject(DateTimeProvider);
    board = alepha.inject(ProjectDashboardController);
    project = await createTestProject(alepha);
    await createTestMember(alepha, project, project.createdBy!);
    user = { id: project.createdBy!, roles: ["user"] };
    for (let i = 0; i < 3; i += 1) {
      await createTestQuest(alepha, project, {
        acceptedAt: dateTime.nowISOString(),
        completedAt: dateTime.nowISOString(),
        completionMessage: `Shipped ${i}`,
      });
    }
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const load = async () =>
    (
      await board.getProjectDashboard.fetch(
        { params: { projectId: project.id } },
        { user },
      )
    ).data;

  it("shows no dormant line on a project that moved recently", async ({
    expect,
  }) => {
    const loaded = await load();

    expect(loaded.dormantSince).toBeUndefined();
  });

  it("turns a quiet project's board into the line and what it shipped", async ({
    expect,
  }) => {
    await dateTime.travel(120, "days");

    const loaded = await load();

    expect(loaded.computed).toBe(true);
    expect(loaded.dormantSince).toBeDefined();
    expect(loaded.cards.map((card) => [card.slot, card.metric])).toEqual([
      ["dormant", "recentlyShipped"],
    ]);
    expect(loaded.values[0]?.value).toBe(3);
  });

  it("leaves a customized board alone", async ({ expect }) => {
    await board.addProjectDashboardCard.fetch(
      {
        params: { projectId: project.id },
        body: {
          metric: "activeQuests",
          scope: { kind: "projects", projectIds: [project.id] },
        },
      },
      { user },
    );
    await dateTime.travel(120, "days");

    const loaded = await load();

    expect(loaded.computed).toBe(false);
    expect(loaded.dormantSince).toBeUndefined();
    expect(loaded.cards.map((card) => card.metric)).toEqual(["activeQuests"]);
  });
});
