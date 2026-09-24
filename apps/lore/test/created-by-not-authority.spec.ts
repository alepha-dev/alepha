import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { FeedbackCommentController } from "../src/api/controllers/FeedbackCommentController.ts";
import { FeedbackController } from "../src/api/controllers/FeedbackController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";
import {
  createTestMemberByProjectId,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

/**
 * #Q2515: `projects.createdBy` records who created the project. An ownership
 * transfer swaps ranks and never moves it, so three checks still reading it
 * kept the ex-creator's powers and denied the new owner theirs. The worst:
 * a demoted ex-creator could still delete anyone's feedback comments.
 */
describe("projects.createdBy decides nothing after an ownership transfer", () => {
  const setup = async () => {
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
    await alepha.start();

    const users = alepha.inject(UserService);
    const token = async (username: string): Promise<UserAccountToken> => ({
      id: (await users.createUser({ username })).id,
      roles: ["user"],
    });
    const founder = await token("founder");
    const heir = await token("heir");
    const reporter = await token("reporter");

    const projects = alepha.inject(ProjectController);
    const created = await projects.createProject.fetch(
      {
        body: {
          title: "Handed over",
          capabilities: [{ key: "work" }, { key: "support" }],
        },
      },
      { user: founder },
    );
    const projectId = created.data.id;
    await createTestMemberByProjectId(alepha, projectId, heir.id);

    // A quest the founder wrote, before handing the project over.
    const quest = await createTestQuest(alepha, created.data as never, {
      projectId,
      createdBy: founder.id,
    });

    // A reporter's feedback, with the reporter's own comment on it.
    const feedback = alepha.inject(FeedbackController);
    const comments = alepha.inject(FeedbackCommentController);
    const item = await feedback.submitFeedback.fetch(
      {
        params: { projectId },
        body: { title: "It crashes", description: "x" },
      } as never,
      { user: reporter },
    );
    const comment = await comments.createFeedbackComment.fetch(
      { params: { id: item.data.id }, body: { body: "Safari 18." } },
      { user: reporter },
    );

    await projects.transferOwnership.fetch(
      { params: { id: projectId }, body: { userId: heir.id, rank: "viewer" } },
      { user: founder },
    );

    return {
      founder,
      heir,
      quest,
      commentId: comment.data.id,
      comments,
      quests: alepha.inject(QuestController),
    };
  };

  it("lets the new owner delete a reporter's feedback comment, and not the demoted founder", async ({
    expect,
  }) => {
    const ctx = await setup();

    await expect(
      ctx.comments.deleteFeedbackComment.fetch(
        { params: { id: ctx.commentId } },
        { user: ctx.founder },
      ),
    ).rejects.toMatchObject({ status: 403 });

    const done = await ctx.comments.deleteFeedbackComment.fetch(
      { params: { id: ctx.commentId } },
      { user: ctx.heir },
    );
    expect(done.data.ok).toBe(true);
  });

  it("lets the new owner edit the objectives of, and delete, the founder's quest", async ({
    expect,
  }) => {
    const ctx = await setup();

    const edited = await ctx.quests.updateQuestObjectives.fetch(
      {
        params: { id: ctx.quest.id },
        body: { objectives: [{ title: "Ship it", completed: false }] },
      },
      { user: ctx.heir },
    );
    expect(edited.data.objectives.map((o) => o.title)).toEqual(["Ship it"]);

    const removed = await ctx.quests.deleteQuest.fetch(
      { params: { id: ctx.quest.id } },
      { user: ctx.heir },
    );
    expect(removed.data.ok).toBe(true);
  });
});
