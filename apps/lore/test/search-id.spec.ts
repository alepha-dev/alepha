import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DirectoryController } from "../src/api/controllers/DirectoryController.ts";
import { EpicController } from "../src/api/controllers/EpicController.ts";
import { FeedbackController } from "../src/api/controllers/FeedbackController.ts";
import { FolioController } from "../src/api/controllers/FolioController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { ReleaseController } from "../src/api/controllers/ReleaseController.ts";
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
 * this is the half that needs the tables: every kind's hit for one number,
 * above the body matches, which are kept.
 *
 * Epics, releases and feedback joined with #Q2228: they answer a number
 * (typed or bare) and nothing else, so `#E1` finds epic 1 where it used to
 * find nothing.
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
  epics: EpicController;
  releases: ReleaseController;
  feedback: FeedbackController;
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
    epics: alepha.inject(EpicController),
    releases: alepha.inject(ReleaseController),
    feedback: alepha.inject(FeedbackController),
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
    // Epics and releases are Work OPTIONS and feedback is the Support
    // capability: all three have to be on for their numbers to answer.
    const project = await ctx.projects.createProject.fetch(
      {
        body: {
          title: "Search ids",
          capabilities: [
            { key: "work", options: { epics: true, releases: true } },
            { key: "knowledge" },
            { key: "support" },
          ],
        },
      },
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

    const epic = await ctx.epics.createEpic.fetch(
      { params: { projectId }, body: { title: "Warding epic" } },
      { user },
    );
    const release = await ctx.releases.createRelease.fetch(
      { params: { projectId }, body: { tag: "0.1.0" } },
      { user },
    );
    await ctx.feedback.submitFeedback.fetch(
      {
        params: { projectId },
        body: { title: "Ward report", description: "The gate sticks." },
      },
      { user },
    );

    expect(quest.data.shortId).toBe(1);
    expect(folio.data.shortId).toBe(1);
    expect(directory.data.shortId).toBe(1);
    expect(epic.data.number).toBe(1);
    expect(release.data.number).toBe(1);

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

  const EVERY_KIND = [
    "directory",
    "epic",
    "feedback",
    "folio",
    "quest",
    "release",
  ];

  it("returns every kind carrying the number, first", async () => {
    const { user, projectId } = await seed();

    const result = await ctx.search.search.fetch(
      { params: { projectId }, query: { q: "1" } },
      { user },
    );
    const hits = result.data.hits;

    expect(kindsWithId(hits, 1)).toEqual(EVERY_KIND);
    // Pinned above the body match, whatever the kind.
    expect(hits.slice(0, 6).every((hit) => hit.shortId === 1)).toBe(true);
    // And the body match is still there, underneath: not wrong, less likely.
    expect(hits.slice(6).map((hit) => hit.title)).toContain("Reading list");
  });

  it("takes the hash form the same way", async () => {
    const { user, projectId } = await seed();

    const result = await ctx.search.search.fetch(
      { params: { projectId }, query: { q: "#1" } },
      { user },
    );

    expect(kindsWithId(result.data.hits, 1)).toEqual(EVERY_KIND);
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

    // Epics, releases and feedback answer their own letter (#Q2228).
    const epics = await ctx.search.search.fetch(
      { params: { projectId }, query: { q: "#E1" } },
      { user },
    );
    expect(kindsWithId(epics.data.hits, 1)).toEqual(["epic"]);

    const feedback = await ctx.search.search.fetch(
      { params: { projectId }, query: { q: "#P1" } },
      { user },
    );
    expect(kindsWithId(feedback.data.hits, 1)).toEqual(["feedback"]);
  });

  it("carries a release hit's tag, which is what its page is addressed by", async () => {
    const { user, projectId } = await seed();

    const result = await ctx.search.search.fetch(
      { params: { projectId }, query: { q: "#R1" } },
      { user },
    );

    expect(result.data.hits).toEqual([
      expect.objectContaining({ kind: "release", shortId: 1, tag: "0.1.0" }),
    ]);
  });

  it("does not match an epic, a release or a feedback item by title", async () => {
    // Number only, as the report asked: `Ward` is in all three titles.
    const { user, projectId } = await seed();

    const result = await ctx.search.search.fetch(
      { params: { projectId }, query: { q: "Ward" } },
      { user },
    );
    const kinds = result.data.hits.map((hit) => hit.kind);

    expect(kinds).not.toContain("epic");
    expect(kinds).not.toContain("release");
    expect(kinds).not.toContain("feedback");
    expect(kinds).toContain("quest");
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
