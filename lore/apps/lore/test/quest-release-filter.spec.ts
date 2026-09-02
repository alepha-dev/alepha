import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { ReleaseController } from "../src/api/controllers/ReleaseController.ts";
import { LoreApi } from "../src/api/index.ts";
import { QUEST_RELEASE_NONE } from "../src/api/schemas/questReleaseFilter.ts";

/**
 * "What is still unassigned" is the question a release planner asks most, and
 * until #1700 the release filter could not answer it: every option was a
 * release.
 *
 * The sentinel rides in the same multi-value parameter as the ids, because
 * the filter's selections OR together and a second parameter would AND -
 * "no release, or 0.29.0" has to be expressible.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  releaseController: ReleaseController;
  questController: QuestController;
  fakeProvider: FakeProvider;
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
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    releaseController: alepha.inject(ReleaseController),
    questController: alepha.inject(QuestController),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

describe("filtering quests by release", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /**
   * Three quests: one in `0.28.0`, one in `0.29.0`, one in neither.
   */
  const world = async () => {
    const fakeUser = ctx.fakeProvider.generate(userDataSchema);
    const created = await ctx.adminUserController.createUser.fetch(
      { body: { ...fakeUser, roles: ["user"] } },
      { user: adminUser },
    );
    const user = { id: created.data.id, roles: created.data.roles };

    const project = (
      await ctx.projectController.createProject.fetch(
        { body: { title: "Release Filter" } },
        { user },
      )
    ).data;

    const release = async (tag: string) =>
      (
        await ctx.releaseController.createRelease.fetch(
          { params: { projectId: project.id }, body: { tag } },
          { user },
        )
      ).data;

    const first = await release("0.28.0");
    const second = await release("0.29.0");

    const quest = async (title: string, releaseId?: number) =>
      (
        await ctx.questController.createQuest.fetch(
          {
            body: {
              projectId: project.id,
              title,
              area: "orm",
              priority: "medium",
              ...(releaseId != null ? { releaseId } : {}),
            },
          },
          { user },
        )
      ).data;

    await quest("In 0.28.0", first.id);
    await quest("In 0.29.0", second.id);
    await quest("Unassigned");

    return { user, project, first, second };
  };

  const titles = async (
    user: { id: string; roles: string[] },
    projectId: number,
    releaseId: string,
  ) => {
    const page = await ctx.questController.getQuests.fetch(
      { params: { projectId }, query: { releaseId } as never },
      { user },
    );
    return page.data.content
      .map((quest: any) => quest.title as string)
      .sort((a, b) => a.localeCompare(b));
  };

  it("selects only the quests attached to no release", async ({ expect }) => {
    const { user, project } = await world();

    expect(await titles(user, project.id, QUEST_RELEASE_NONE)).toEqual([
      "Unassigned",
    ]);
  });

  it("ORs the sentinel with a named release", async ({ expect }) => {
    const { user, project, second } = await world();

    expect(
      await titles(user, project.id, `${QUEST_RELEASE_NONE},${second.id}`),
    ).toEqual(["In 0.29.0", "Unassigned"]);
  });

  it("ORs the sentinel with several named releases", async ({ expect }) => {
    const { user, project, first, second } = await world();

    expect(
      await titles(
        user,
        project.id,
        `${QUEST_RELEASE_NONE},${first.id},${second.id}`,
      ),
    ).toEqual(["In 0.28.0", "In 0.29.0", "Unassigned"]);
  });

  it("still filters by ids alone", async ({ expect }) => {
    const { user, project, first } = await world();

    // The branch that existed before, which the sentinel must not disturb:
    // without it, "no release" quests stay out.
    expect(await titles(user, project.id, String(first.id))).toEqual([
      "In 0.28.0",
    ]);
  });

  it("returns everything when the filter is absent", async ({ expect }) => {
    const { user, project } = await world();

    const page = await ctx.questController.getQuests.fetch(
      { params: { projectId: project.id }, query: {} as never },
      { user },
    );
    expect(page.data.content.length).toBe(3);
  });
});
