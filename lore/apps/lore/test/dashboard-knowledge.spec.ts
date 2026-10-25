import {
  DashboardMetricRegistry,
  ProjectDashboardController,
} from "@lore/core/api";
import type { DashboardCardValue, Project } from "@lore/core/schemas";
import { ReadCounter } from "@lore/core/testing";
import { folioDirectories } from "@lore/knowledge/schemas";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestFolio,
  createTestMember,
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

class KnowledgeRepositories extends TestEntityRepositories {
  directories = $repository(folioDirectories);
}

/**
 * The Knowledge tiles of #E77 (#Q2658): before them a Knowledge-only project
 * (Lanthanides) had no tile at all.
 */
describe("dashboard knowledge tiles", () => {
  let alepha: Alepha;
  let repos: KnowledgeRepositories;
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
    repos = alepha.inject(KnowledgeRepositories);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [{ key: "knowledge" }],
    });
    await createTestMember(alepha, project, project.createdBy!);
    user = { id: project.createdBy!, roles: ["user"] };
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const resolve = async (metric: string): Promise<DashboardCardValue> =>
    (
      await alepha.inject(DashboardMetricRegistry).resolveForProject(
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

  it("answers noFolio for each tile in a project with none", async ({
    expect,
  }) => {
    for (const metric of [
      "pinnedFolio",
      "recentFolios",
      "foliosThisMonth",
      "foliosByDirectory",
    ]) {
      expect((await resolve(metric)).empty, metric).toBe("noFolio");
    }
  });

  it("shows the pinned folio's summary, else its opening paragraph", async ({
    expect,
  }) => {
    await createTestFolio(alepha, project, {
      title: "Accueil",
      pinned: true,
      content: "# Accueil\n\nBienvenue dans le projet.\n\nSuite.",
    });

    const value = await resolve("pinnedFolio");

    expect(value.detail.markdown).toBe("Bienvenue dans le projet.");
    expect(value.link?.route).toBe("projectFoliosFolio");
  });

  it("counts folios per top-level directory, nested ones included", async ({
    expect,
  }) => {
    const notes = await repos.directories.create({
      projectId: project.id,
      shortId: 1,
      name: "Notes",
    });
    const inner = await repos.directories.create({
      projectId: project.id,
      shortId: 2,
      name: "2026",
      parentId: notes.id,
    });
    await createTestFolio(alepha, project, { directoryId: notes.id });
    await createTestFolio(alepha, project, { directoryId: inner.id });
    await createTestFolio(alepha, project);

    const value = await resolve("foliosByDirectory");

    expect(value.segments).toEqual([
      { label: "Notes", value: 2 },
      { label: "/", value: 1 },
    ]);
  });

  it("lists the folios created in the window", async ({ expect }) => {
    await createTestFolio(alepha, project, { title: "Decision" });

    const value = await resolve("foliosThisMonth");

    expect(value.rows?.map((row) => row.title)).toEqual(["Decision"]);
  });

  it("renders a full board for a knowledge-only project", async ({
    expect,
  }) => {
    await createTestFolio(alepha, project, { title: "Accueil", pinned: true });
    await createTestFolio(alepha, project, { title: "Glossaire" });

    const board = await alepha
      .inject(ProjectDashboardController)
      .getProjectDashboard.fetch(
        { params: { projectId: project.id } },
        { user },
      );

    expect(board.data.cards.map((card) => [card.slot, card.metric])).toEqual([
      ["headline", "recentFolios"],
      ["knowledge", "pinnedFolio"],
    ]);
  });
});
