import { CommentService, ProjectController } from "@lore/core/api";
import { comments } from "@lore/core/schemas";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  LorePlanApi,
  QuestCommentController,
  QuestController,
} from "../src/api/index.ts";

class Probe {
  comments = $repository(comments);
}

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LorePlanApi);
  const probe = alepha.inject(Probe);
  const service = alepha.inject(CommentService);
  // Another package's subject on the same table, as Ship registers `error`.
  service.registerSubject({ type: "other", load: async () => ({}) });
  await alepha.start();
  const fake = alepha.inject(FakeProvider).generate(userDataSchema);
  const created = await alepha
    .inject(AdminUserController)
    .createUser.fetch(
      { body: { ...fake, roles: ["user"] } },
      { user: adminUser },
    );
  const user = { id: created.data.id, roles: created.data.roles };
  const projects = alepha.inject(ProjectController);
  const quests = alepha.inject(QuestController);
  const project = async (title: string) =>
    (await projects.createProject.fetch({ body: { title } }, { user })).data.id;
  const quest = async (projectId: number) =>
    (
      await quests.createQuest.fetch(
        {
          body: {
            projectId,
            title: "Something to talk about",
            description: "",
            area: "ops",
            priority: "low",
          },
        },
        { user },
      )
    ).data;
  return {
    alepha,
    probe,
    service,
    user,
    quests,
    project,
    quest,
    api: alepha.inject(QuestCommentController),
  };
};

type World = Awaited<ReturnType<typeof setup>>;

/**
 * A quest's discussion on core's `comments` (#E185): where the rows land,
 * what a quest's delete leaves, and the wall between a quest's comments and
 * every other subject's on the one table. The thread's own behaviour is
 * `quest-comments.spec.ts`, unchanged by the move.
 */
describe("a quest's discussion on core's comments", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });
  afterEach(async () => {
    await w.alepha.stop();
  });

  it("writes the comment under the quest subject, with the quest's project, and answers it as before", async ({
    expect,
  }) => {
    const projectId = await w.project("Discussion probe");
    const quest = await w.quest(projectId);

    const created = await w.api.createQuestComment.fetch(
      {
        params: { id: quest.id },
        body: { body: "Do X differently", source: { kind: "mcp" } },
      },
      { user: w.user },
    );

    expect(await w.probe.comments.findMany()).toMatchObject([
      {
        id: created.data.id,
        projectId,
        subjectType: "quest",
        subjectId: quest.id,
        authorId: w.user.id,
        body: "Do X differently",
        source: { kind: "mcp" },
      },
    ]);
    // The wire still says `questId`, and names no subject.
    expect(created.data).toMatchObject({ questId: quest.id });
    expect(created.data).not.toHaveProperty("subjectType");
    const listed = await w.api.listQuestComments.fetch(
      { params: { id: quest.id }, query: {} },
      { user: w.user },
    );
    expect(listed.data).toMatchObject([
      { id: created.data.id, questId: quest.id, body: "Do X differently" },
    ]);
  });

  it("leaves no comment row behind a deleted quest, and keeps every other thread", async ({
    expect,
  }) => {
    const projectId = await w.project("Discussion probe");
    const doomed = await w.quest(projectId);
    const kept = await w.quest(projectId);
    for (const [quest, body] of [
      [doomed, "Doomed"],
      [doomed, "Doomed too"],
      [kept, "Kept"],
    ] as const) {
      await w.api.createQuestComment.fetch(
        { params: { id: quest.id }, body: { body } },
        { user: w.user },
      );
    }
    // Same id, another subject: a quest's delete is not its business.
    await w.probe.comments.create({
      projectId,
      subjectType: "other",
      subjectId: doomed.id,
      authorId: w.user.id,
      body: "Another subject's",
    });

    await w.quests.deleteQuest.fetch(
      { params: { id: doomed.id } },
      { user: w.user },
    );

    expect(
      (
        await w.probe.comments.findMany({
          orderBy: [{ column: "id", direction: "asc" }],
        })
      ).map((comment) => comment.body),
    ).toEqual(["Kept", "Another subject's"]);
  });

  it("answers a 404 for another subject's comment reached through a quest route", async ({
    expect,
  }) => {
    const projectId = await w.project("Discussion probe");
    await w.quest(projectId);
    const foreign = await w.probe.comments.create({
      projectId,
      subjectType: "other",
      subjectId: 1,
      authorId: w.user.id,
      body: "Not a quest's",
    });

    await expect(
      w.api.updateQuestComment.fetch(
        { params: { id: foreign.id }, body: { body: "Rewritten" } },
        { user: w.user },
      ),
    ).rejects.toThrow("Comment not found");
    await expect(
      w.api.deleteQuestComment.fetch(
        { params: { id: foreign.id } },
        { user: w.user },
      ),
    ).rejects.toThrow("Comment not found");
    expect((await w.probe.comments.findById(foreign.id))?.body).toBe(
      "Not a quest's",
    );
  });

  it("refuses a comment on a quest of another project, through the subject's own guard", async ({
    expect,
  }) => {
    const mine = await w.project("Mine");
    const theirs = await w.project("Theirs");
    const quest = await w.quest(theirs);

    await expect(
      w.service.add({
        type: "quest",
        projectId: mine,
        subjectId: quest.id,
        authorId: w.user.id,
        body: "Across projects",
      }),
    ).rejects.toThrow("Quest not found");
    expect(await w.probe.comments.count()).toBe(0);
  });
});
