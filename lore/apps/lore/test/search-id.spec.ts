import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DirectoryController } from "../src/api/controllers/DirectoryController.ts";
import { FolioController } from "../src/api/controllers/FolioController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { SearchController } from "../src/api/controllers/SearchController.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * A bare number in the palette finds everything carrying that shortId.
 *
 * Quests, folios and directories each number their rows per project, and
 * each number is the addressing form of a URL. The lookup used to reach
 * quests only, so `44` typed while reading folio #44 returned quest #44
 * and whichever folios mentioned 44 in their body, and never the folio
 * itself (quest #1676). The ranking half lives in `search-ranking.spec.ts`;
 * this is the half that needs the tables: three shortId hits for one
 * number, above the body matches, which are kept.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  admin: AdminUserController;
  projects: ProjectController;
  quests: QuestController;
  folios: FolioController;
  directories: DirectoryController;
  search: SearchController;
  fake: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);

  await alepha.start();

  return {
    alepha,
    admin: alepha.inject(AdminUserController),
    projects: alepha.inject(ProjectController),
    quests: alepha.inject(QuestController),
    folios: alepha.inject(FolioController),
    directories: alepha.inject(DirectoryController),
    search: alepha.inject(SearchController),
    fake: alepha.inject(FakeProvider),
  };
};

type TestUser = { id: string; roles: string[] };

const createTestUser = async (ctx: TestContext): Promise<TestUser> => {
  const fakeUser = ctx.fake.generate(userDataSchema);
  const response = await ctx.admin.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

describe("SearchController, an id query", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const seed = async () => {
    const user = await createTestUser(ctx);
    const project = await ctx.projects.createProject.fetch(
      { body: { title: "Search ids" } },
      { user },
    );
    const projectId = project.data.id;

    // The first row of each table takes shortId 1.
    const quest = await ctx.quests.createQuest.fetch(
      {
        body: { projectId, title: "Gate ward", area: "Main", priority: "low" },
      },
      { user },
    );
    const folio = await ctx.folios.create.fetch(
      { body: { projectId, title: "Warding notes", content: "" } },
      { user },
    );
    const directory = await ctx.directories.createDirectory.fetch(
      { params: { projectId }, body: { name: "Wards" } },
      { user },
    );
    // A folio whose body merely mentions the number: kept, but underneath.
    await ctx.folios.create.fetch(
      {
        body: {
          projectId,
          title: "Reading list",
          content: "Chapter 1 is the one to read first.",
        },
      },
      { user },
    );

    expect(quest.data.shortId).toBe(1);
    expect(folio.data.shortId).toBe(1);
    expect(directory.data.shortId).toBe(1);

    return { user, projectId };
  };

  const kindsWithId = (
    hits: Array<{ kind: string; shortId?: number }>,
    id: number,
  ) =>
    hits
      .filter((hit) => hit.shortId === id)
      .map((hit) => hit.kind)
      .sort();

  it("returns the quest, the folio and the directory carrying the number, first", async () => {
    const { user, projectId } = await seed();

    const result = await ctx.search.search.fetch(
      { params: { projectId }, query: { q: "1" } },
      { user },
    );
    const hits = result.data.hits;

    expect(kindsWithId(hits, 1)).toEqual(["directory", "folio", "quest"]);
    // Pinned above the body match, whatever the kind.
    expect(hits.slice(0, 3).every((hit) => hit.shortId === 1)).toBe(true);
    // And the body match is still there, underneath: not wrong, less likely.
    expect(hits.slice(3).map((hit) => hit.title)).toContain("Reading list");
  });

  it("takes the hash form the same way", async () => {
    const { user, projectId } = await seed();

    const result = await ctx.search.search.fetch(
      { params: { projectId }, query: { q: "#1" } },
      { user },
    );

    expect(kindsWithId(result.data.hits, 1)).toEqual([
      "directory",
      "folio",
      "quest",
    ]);
  });

  it("a typed reference restricts the id match to its own kind (epic #32)", async () => {
    const { user, projectId } = await seed();

    const quests = await ctx.search.search.fetch(
      { params: { projectId }, query: { q: "#Q1" } },
      { user },
    );
    expect(kindsWithId(quests.data.hits, 1)).toEqual(["quest"]);

    // Case-insensitive on the way in, like every other reader of the grammar.
    const folios = await ctx.search.search.fetch(
      { params: { projectId }, query: { q: "#f1" } },
      { user },
    );
    expect(kindsWithId(folios.data.hits, 1)).toEqual(["folio"]);

    // A letter for a kind this search does not index matches nothing by id.
    const epics = await ctx.search.search.fetch(
      { params: { projectId }, query: { q: "#E1" } },
      { user },
    );
    expect(kindsWithId(epics.data.hits, 1)).toEqual([]);
  });

  it("finds nothing by number in another project's rows", async () => {
    const { user } = await seed();
    const other = await ctx.projects.createProject.fetch(
      { body: { title: "Empty" } },
      { user },
    );

    const result = await ctx.search.search.fetch(
      { params: { projectId: other.data.id }, query: { q: "1" } },
      { user },
    );

    expect(result.data.hits).toEqual([]);
  });
});
