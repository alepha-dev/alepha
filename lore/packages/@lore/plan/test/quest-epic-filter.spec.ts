import { ProjectController } from "@lore/core/api";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import { EpicController, QuestController } from "../src/api/index.ts";
import { LorePlanApi } from "../src/api/index.ts";
import { QUEST_EPIC_NONE } from "../src/schemas/index.ts";

/**
 * The Quests table's Epic filter (#Q3270): several epics at once, and "No
 * epic" for the quests filed under none, in one comma-joined parameter whose
 * selections OR together, as the release filter's do.
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
  epicController: EpicController;
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
  alepha.with(LorePlanApi);

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    epicController: alepha.inject(EpicController),
    questController: alepha.inject(QuestController),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

describe("filtering quests by epic", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /**
   * Three quests: one under each of two epics, one under neither. Both epics
   * are drafts, which the backlog hides until an epic is named.
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
        { body: { title: "Epic Filter" } },
        { user },
      )
    ).data;

    const epic = async (title: string) =>
      (
        await ctx.epicController.createEpic.fetch(
          { params: { projectId: project.id }, body: { title } },
          { user },
        )
      ).data;

    const first = await epic("First epic");
    const second = await epic("Second epic");

    const quest = async (title: string, epicId?: number) => {
      const made = (
        await ctx.questController.createQuest.fetch(
          {
            body: {
              projectId: project.id,
              title,
              area: "orm",
              priority: "medium",
            },
          },
          { user },
        )
      ).data;
      if (epicId != null) {
        await ctx.epicController.attachQuest.fetch(
          { params: { id: epicId }, body: { questId: made.id } },
          { user },
        );
      }
      return made;
    };

    await quest("In first", first.id);
    await quest("In second", second.id);
    await quest("Loose");

    return { user, project, first, second };
  };

  const titles = async (
    user: { id: string; roles: string[] },
    projectId: number,
    query: { epicId?: string; epic?: number },
  ) => {
    const page = await ctx.questController.getQuests.fetch(
      { params: { projectId }, query },
      { user },
    );
    return page.data.content
      .map((quest: any) => quest.title as string)
      .sort((a, b) => a.localeCompare(b));
  };

  it("selects only the quests filed under no epic", async ({ expect }) => {
    const { user, project } = await world();

    expect(await titles(user, project.id, { epicId: QUEST_EPIC_NONE })).toEqual(
      ["Loose"],
    );
  });

  it("selects several epics at once, drafts included", async ({ expect }) => {
    const { user, project, first, second } = await world();

    expect(
      await titles(user, project.id, { epicId: `${first.id},${second.id}` }),
    ).toEqual(["In first", "In second"]);
  });

  it("ORs the sentinel with a named epic", async ({ expect }) => {
    const { user, project, second } = await world();

    expect(
      await titles(user, project.id, {
        epicId: `${QUEST_EPIC_NONE},${second.id}`,
      }),
    ).toEqual(["In second", "Loose"]);
  });

  it("filters by one id alone", async ({ expect }) => {
    const { user, project, first } = await world();

    expect(
      await titles(user, project.id, { epicId: String(first.id) }),
    ).toEqual(["In first"]);
  });

  it("drops a value it cannot read rather than refusing", async ({
    expect,
  }) => {
    const { user, project } = await world();

    // The backlog, as with no filter: the two draft epics' quests stay out.
    expect(await titles(user, project.id, { epicId: "abc" })).toEqual([
      "Loose",
    ]);
  });

  it("leaves the single-epic parameter as it was", async ({ expect }) => {
    const { user, project, first } = await world();

    expect(await titles(user, project.id, { epic: first.id })).toEqual([
      "In first",
    ]);
  });
});
