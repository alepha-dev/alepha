import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { SearchController } from "@/api/controllers/SearchController.ts";
import { folioDirectories } from "@/api/entities/folioDirectories.ts";
import { folios } from "@/api/entities/folios.ts";
import type { Project } from "@/api/entities/projects.ts";
import { LoreApi } from "@/api/index.ts";
import type { CapabilityKey } from "@/api/schemas/capabilityKeySchema.ts";

import {
  createTestMember,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

/**
 * The ⌘K palette is Core; the tables it reaches into are not.
 *
 * ⚠️ **A Knowledge-only project must never answer with a quest.** Disabling a
 * capability hides it and never deletes anything, so every quest a project
 * had is still on disk - and the palette would be the one surface left
 * offering a way into a capability the project turned off, from a keystroke,
 * past every route guard. It skips the query rather than filtering the rows,
 * so a disabled kind also costs no statement.
 */
class SearchCapabilityRepositories {
  folios = $repository(folios);
  directories = $repository(folioDirectories);
}

interface TestContext {
  alepha: Alepha;
  search: SearchController;
  repos: SearchCapabilityRepositories;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreApi);

  alepha.inject(TestEntityRepositories);
  const repos = alepha.inject(SearchCapabilityRepositories);
  await alepha.start();

  return { alepha, search: alepha.inject(SearchController), repos };
};

let folioSeq = 0;

/**
 * A project holding one quest, one folio and one directory, all named
 * "amber", so a single query reaches all three tables.
 */
const seeded = async (
  ctx: TestContext,
  capabilities: Array<{
    key: CapabilityKey;
    options?: Record<string, boolean>;
  }>,
): Promise<{ user: UserAccountToken; project: Project }> => {
  const project = await createTestProject(ctx.alepha, { capabilities });
  await createTestMember(ctx.alepha, project, project.createdBy!);

  await createTestQuest(ctx.alepha, project, { title: "amber quest" });

  folioSeq += 1;
  await ctx.repos.folios.create({
    projectId: project.id,
    shortId: folioSeq,
    title: "amber folio",
    content: "amber",
    searchText: "amber folio",
  });
  await ctx.repos.directories.create({
    projectId: project.id,
    shortId: folioSeq,
    name: "amber",
  });

  return { user: { id: project.createdBy!, roles: ["user"] }, project };
};

const search = async (
  ctx: TestContext,
  project: Project,
  user: UserAccountToken,
) =>
  ctx.search.search(
    { params: { projectId: project.id }, query: { q: "amber" } },
    { user },
  );

describe("the command palette and capabilities", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("returns all three kinds when the project does both", async ({
    expect,
  }) => {
    const { user, project } = await seeded(ctx, [
      { key: "work" },
      { key: "knowledge" },
    ]);

    const { hits } = await search(ctx, project, user);
    expect([...new Set(hits.map((it) => it.kind))].sort()).toEqual([
      "directory",
      "folio",
      "quest",
    ]);
  });

  it("returns no quest hit on a Knowledge-only project", async ({ expect }) => {
    const { user, project } = await seeded(ctx, [{ key: "knowledge" }]);

    const { hits } = await search(ctx, project, user);
    expect(hits.some((it) => it.kind === "quest")).toBe(false);
    // Knowledge's own two are untouched, which is the half that proves the
    // filter is about capabilities rather than about the query.
    expect([...new Set(hits.map((it) => it.kind))].sort()).toEqual([
      "directory",
      "folio",
    ]);
  });

  it("returns no folio or directory hit on a Work-only project", async ({
    expect,
  }) => {
    const { user, project } = await seeded(ctx, [{ key: "work" }]);

    const { hits } = await search(ctx, project, user);
    expect(hits.map((it) => it.kind)).toEqual(["quest"]);
  });

  it("answers nothing at all for a project with no capabilities", async ({
    expect,
  }) => {
    // A legal state by decision 8 of the epic, and the modularity test: the
    // endpoint still resolves, still gates on membership, and simply has
    // nothing to look in.
    const { user, project } = await seeded(ctx, []);

    const { hits } = await search(ctx, project, user);
    expect(hits).toEqual([]);
  });
});
