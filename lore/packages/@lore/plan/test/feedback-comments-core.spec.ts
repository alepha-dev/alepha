import { CommentService, ProjectController } from "@lore/core/api";
import { comments } from "@lore/core/schemas";
import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  FeedbackCommentController,
  FeedbackController,
  LorePlanApi,
} from "../src/api/index.ts";

class Probe {
  comments = $repository(comments);
}

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
  const feedbackApi = alepha.inject(FeedbackController);
  const commentApi = alepha.inject(FeedbackCommentController);
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const reporter = await users.createUser({ username: "reporter" });
  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] });
      return fn();
    });
  const project = await asUser(owner.id, () =>
    projectApi.createProject({
      body: {
        title: "Test",
        capabilities: [{ key: "plan", options: { feedback: true } }],
      },
    }),
  );
  const report = (title: string) =>
    asUser(reporter.id, () =>
      feedbackApi.submitFeedback({
        params: { projectId: project.id },
        body: { title, description: "x" },
      }),
    );
  const say = (feedbackId: number, body: string, userId: string) =>
    asUser(userId, () =>
      commentApi.createFeedbackComment({
        params: { id: feedbackId },
        body: { body },
      }),
    );
  return {
    alepha,
    probe,
    feedbackApi,
    commentApi,
    project,
    asUser,
    report,
    say,
    OWNER: owner.id,
    REPORTER: reporter.id,
  };
};

type World = Awaited<ReturnType<typeof setup>>;

/**
 * A feedback item's thread on core's `comments` (#E185): where the rows
 * land, what the item's two deletes leave, and the wall between its
 * comments and every other subject's. Who may read and write the thread is
 * `feedback-comments.spec.ts`, unchanged by the move.
 */
describe("a feedback thread on core's comments", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });
  afterEach(async () => {
    await w.alepha.stop();
  });

  it("writes a reporter's and a member's comment under the feedback subject, with the item's project", async ({
    expect,
  }) => {
    const item = await w.report("It crashes");

    const question = await w.say(item.id, "Which browser?", w.OWNER);
    const answer = await w.say(item.id, "Safari.", w.REPORTER);

    expect(
      await w.probe.comments.findMany({
        orderBy: [{ column: "id", direction: "asc" }],
      }),
    ).toMatchObject([
      {
        id: question.id,
        projectId: w.project.id,
        subjectType: "feedback",
        subjectId: item.id,
        authorId: w.OWNER,
      },
      {
        id: answer.id,
        projectId: w.project.id,
        subjectType: "feedback",
        subjectId: item.id,
        authorId: w.REPORTER,
      },
    ]);
    // No file is stored as none, and still answered as an empty list.
    expect(
      (await w.probe.comments.findById(answer.id))?.attachments ?? undefined,
    ).toBeUndefined();
    expect(answer).toMatchObject({ feedbackId: item.id, attachments: [] });
    expect(answer).not.toHaveProperty("subjectType");
  });

  it("leaves no comment row behind an item removed by a member or by its reporter", async ({
    expect,
  }) => {
    const removed = await w.report("Removed by the team");
    const withdrawn = await w.report("Withdrawn by its reporter");
    const kept = await w.report("Kept");
    await w.say(removed.id, "Not a bug.", w.OWNER);
    await w.say(withdrawn.id, "Never mind.", w.REPORTER);
    await w.say(kept.id, "Looking.", w.OWNER);

    await w.asUser(w.OWNER, () =>
      w.feedbackApi.removeFeedback({
        params: { projectId: w.project.id, feedbackId: removed.id },
      }),
    );
    await w.asUser(w.REPORTER, () =>
      w.feedbackApi.deleteMyFeedback({ params: { feedbackId: withdrawn.id } }),
    );

    expect(
      (await w.probe.comments.findMany()).map((comment) => comment.body),
    ).toEqual(["Looking."]);
  });

  it("answers a 404 for another subject's comment reached through a feedback route", async ({
    expect,
  }) => {
    const item = await w.report("It crashes");
    const foreign = await w.probe.comments.create({
      projectId: w.project.id,
      subjectType: "other",
      // The item's own id, under another subject: still not its comment.
      subjectId: item.id,
      authorId: w.OWNER,
      body: "Not a feedback comment",
    });

    await expect(
      w.asUser(w.OWNER, () =>
        w.commentApi.updateFeedbackComment({
          params: { id: foreign.id },
          body: { body: "Rewritten" },
        }),
      ),
    ).rejects.toThrow("Comment not found");
    await expect(
      w.asUser(w.OWNER, () =>
        w.commentApi.deleteFeedbackComment({ params: { id: foreign.id } }),
      ),
    ).rejects.toThrow("Comment not found");
    expect(
      await w.asUser(w.OWNER, () =>
        w.commentApi.listFeedbackComments({
          params: { id: item.id },
          query: {},
        }),
      ),
    ).toEqual([]);
    expect((await w.probe.comments.findById(foreign.id))?.body).toBe(
      "Not a feedback comment",
    );
  });
});
