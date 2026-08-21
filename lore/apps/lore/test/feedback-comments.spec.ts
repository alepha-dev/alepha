import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";
import { FeedbackCommentController } from "../src/api/controllers/FeedbackCommentController.ts";
import { FeedbackController } from "../src/api/controllers/FeedbackController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { FeedbackTools } from "../src/mcp/tools/FeedbackTools.ts";

/**
 * Feedback threads, whose whole point is the gate: the reporter is usually
 * NOT a project member, so "members only" would mean the owner asking a
 * question nobody can answer.
 *
 * Same identity-injection shim as `quest-tools-comments.spec.ts`.
 */
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
  alepha.with(AlephaMcp);
  alepha.with(LoreApi);
  alepha.with(LoreMcp);

  const feedbackTools = alepha.inject(FeedbackTools);
  const feedbackApi = alepha.inject(FeedbackController);
  const commentApi = alepha.inject(FeedbackCommentController);
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const reporter = await users.createUser({ username: "reporter" });
  const stranger = await users.createUser({ username: "stranger" });
  const OWNER = owner.id;
  const REPORTER = reporter.id;
  const STRANGER = stranger.id;

  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] } as any);
      return fn();
    });

  // biome-ignore lint/suspicious/noExplicitAny: mirrors quest-tools-comments.spec.ts's own tool-execute helper
  const call = (tool: any, params: Record<string, unknown>, userId = OWNER) =>
    asUser(userId, () => tool.execute(params));

  const project = await asUser(OWNER, () =>
    projectApi.createProject({ body: { title: "Test" } } as any),
  );

  /** Feedback is opt-in per project, and a submit needs the module on. */
  const row = await (projectApi as any).projects.getOne({
    where: { id: { eq: project.id } },
  });
  row.features = { ...row.features, feedback: true };
  await (projectApi as any).projects.save(row);

  const report = (title: string, reporterId = REPORTER) =>
    asUser(reporterId, () =>
      feedbackApi.submitFeedback({
        params: { projectId: project.id },
        body: { title, description: "x" },
      } as any),
    );

  return {
    feedbackTools,
    commentApi,
    project,
    call,
    asUser,
    report,
    OWNER,
    REPORTER,
    STRANGER,
  };
};

describe("Lore feedback comments", () => {
  it("lets the reporter answer on their own item even though they are not a member", async () => {
    const { commentApi, asUser, report, OWNER, REPORTER } = await setup();
    const item = await report("It crashes");

    await asUser(OWNER, () =>
      commentApi.createFeedbackComment({
        params: { id: item.id },
        body: { body: "Which browser?" },
      }),
    );
    await asUser(REPORTER, () =>
      commentApi.createFeedbackComment({
        params: { id: item.id },
        body: { body: "Safari 18." },
      }),
    );

    const thread = await asUser(REPORTER, () =>
      commentApi.listFeedbackComments({
        params: { id: item.id },
        query: {},
      }),
    );

    expect(thread.map((c) => c.body)).toEqual(["Which browser?", "Safari 18."]);
    // Names are resolved server-side: the reporter cannot read the member
    // list, so an unresolved id would leave the thread anonymous for them.
    expect(thread.map((c) => c.authorName)).toEqual(["owner", "reporter"]);
  });

  it("refuses a stranger, as a 404 rather than a 403", async () => {
    const { commentApi, asUser, report, STRANGER } = await setup();
    const item = await report("It crashes");

    await expect(
      asUser(STRANGER, () =>
        commentApi.listFeedbackComments({
          params: { id: item.id },
          query: {},
        }),
      ),
    ).rejects.toThrowError(/not found/i);

    await expect(
      asUser(STRANGER, () =>
        commentApi.createFeedbackComment({
          params: { id: item.id },
          body: { body: "let me in" },
        }),
      ),
    ).rejects.toThrowError(/not found/i);
  });

  it("refuses a reporter on someone else's item", async () => {
    const { commentApi, asUser, report, REPORTER, STRANGER } = await setup();
    // STRANGER reports their own item; REPORTER must not reach its thread.
    const theirs = await report("Not yours", STRANGER);

    await expect(
      asUser(REPORTER, () =>
        commentApi.createFeedbackComment({
          params: { id: theirs.id },
          body: { body: "nosy" },
        }),
      ),
    ).rejects.toThrowError(/not found/i);
  });

  it("lets only the author edit, and the owner delete anyone's", async () => {
    const { commentApi, asUser, report, OWNER, REPORTER } = await setup();
    const item = await report("It crashes");

    const theirs = await asUser(REPORTER, () =>
      commentApi.createFeedbackComment({
        params: { id: item.id },
        body: { body: "Safari 18." },
      }),
    );

    await expect(
      asUser(OWNER, () =>
        commentApi.updateFeedbackComment({
          params: { id: theirs.id },
          body: { body: "rewritten by the owner" },
        }),
      ),
    ).rejects.toThrowError(/only the author/i);

    const edited = await asUser(REPORTER, () =>
      commentApi.updateFeedbackComment({
        params: { id: theirs.id },
        body: { body: "Safari 18.1, actually." },
      }),
    );
    expect(edited.editedAt).toBeTruthy();

    // Deleting IS moderation, so the owner may.
    const gone = await asUser(OWNER, () =>
      commentApi.deleteFeedbackComment({ params: { id: theirs.id } }),
    );
    expect(gone.ok).toBe(true);
  });

  it("stops a reporter deleting the owner's question", async () => {
    const { commentApi, asUser, report, OWNER, REPORTER } = await setup();
    const item = await report("It crashes");

    const question = await asUser(OWNER, () =>
      commentApi.createFeedbackComment({
        params: { id: item.id },
        body: { body: "Which browser?" },
      }),
    );

    await expect(
      asUser(REPORTER, () =>
        commentApi.deleteFeedbackComment({ params: { id: question.id } }),
      ),
    ).rejects.toThrowError(/owner/i);
  });
});

describe("Lore MCP: feedback_comment_add", () => {
  it("posts a comment, marked as agent-authored, and reads it back", async () => {
    const { feedbackTools, project, call, report } = await setup();
    const item = await report("It crashes");

    const posted = await call(feedbackTools.feedback_comment_add, {
      project: project.id,
      id: item.id,
      body: "Reproduced on Safari only, not on Chrome.",
      as: "claude-code",
    });
    expect(posted.authorKind).toBe("agent");
    expect(posted.body).toBe("Reproduced on Safari only, not on Chrome.");

    const read = await call(feedbackTools.feedback_get, {
      project: project.id,
      id: item.id,
    });
    expect(read.discussion).toHaveLength(1);
    expect(read.discussion[0].authorKind).toBe("agent");
    expect(read.discussion[0].author).toBe("owner");
    expect(read.discussionTruncated).toBe(false);
  });

  it("addresses an item by shortId too", async () => {
    const { feedbackTools, project, call, report } = await setup();
    const item = await report("It crashes");
    // `submitFeedback` answers with the global id only, so the per-project
    // shortId comes from a read.
    const { shortId } = await call(feedbackTools.feedback_get, {
      project: project.id,
      id: item.id,
    });

    await call(feedbackTools.feedback_comment_add, {
      project: project.id,
      shortId,
      body: "By shortId.",
    });

    const read = await call(feedbackTools.feedback_get, {
      project: project.id,
      id: item.id,
    });
    expect(read.discussion.map((c: any) => c.body)).toEqual(["By shortId."]);
  });

  it("reports an empty thread without pretending it is truncated", async () => {
    const { feedbackTools, project, call, report } = await setup();
    const item = await report("It crashes");

    const read = await call(feedbackTools.feedback_get, {
      project: project.id,
      id: item.id,
    });
    expect(read.discussion).toEqual([]);
    expect(read.discussionTruncated).toBe(false);
  });
});
