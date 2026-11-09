import { ProjectController } from "@lore/core/api";
import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake } from "alepha/testing/faker";
import { describe, expect, it } from "vitest";

import {
  FeedbackCommentController,
  FeedbackController,
} from "../src/api/index.ts";
import { LoreWorkApi } from "../src/api/index.ts";
import { FeedbackTools } from "../src/mcp/index.ts";
import { LoreWorkMcp } from "../src/mcp/index.ts";

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
  alepha.with(LoreWorkApi);
  alepha.with(LoreWorkMcp);

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
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] });
      return fn();
    });

  // mirrors quest-tools-comments.spec.ts's own tool-execute helper
  const call = (tool: any, params: Record<string, unknown>, userId = OWNER) =>
    asUser(userId, () => tool.execute(params));

  const project = await asUser(OWNER, () =>
    projectApi.createProject({
      body: { title: "Test", capabilities: [{ key: "support" }] },
    }),
  );

  const report = (title: string, reporterId = REPORTER) =>
    asUser(reporterId, () =>
      feedbackApi.submitFeedback({
        params: { projectId: project.id },
        body: { title, description: "x" },
      }),
    );

  return {
    feedbackTools,
    feedbackApi,
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
    ).rejects.toThrow(/not found/i);

    await expect(
      asUser(STRANGER, () =>
        commentApi.createFeedbackComment({
          params: { id: item.id },
          body: { body: "let me in" },
        }),
      ),
    ).rejects.toThrow(/not found/i);
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
    ).rejects.toThrow(/not found/i);
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
    ).rejects.toThrow(/only the author/i);

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
    ).rejects.toThrow(/triages feedback/i);
  });
});

describe("Lore feedback comment attachments", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const png = (name = "shot.png") =>
    new File([PNG], name, { type: "image/png" });

  it("lets the reporter and a member each attach files to a comment", async () => {
    const {
      feedbackApi,
      commentApi,
      asUser,
      report,
      project,
      OWNER,
      REPORTER,
    } = await setup();
    const item = await report("It crashes");

    for (const who of [REPORTER, OWNER]) {
      const uploaded = await asUser(who, () =>
        feedbackApi.uploadFeedbackAttachment({
          params: { projectId: project.id },
          body: { file: png() },
        }),
      );
      // An image alone is an answer: the body may be empty.
      await asUser(who, () =>
        commentApi.createFeedbackComment({
          params: { id: item.id },
          body: { body: "", attachments: [uploaded.id] },
        }),
      );
    }

    const thread = await asUser(REPORTER, () =>
      commentApi.listFeedbackComments({ params: { id: item.id }, query: {} }),
    );
    expect(thread).toHaveLength(2);
    for (const comment of thread) {
      expect(comment.attachmentUrls).toHaveLength(1);
      expect(comment.attachmentUrls?.[0]).toMatchObject({
        name: "shot.png",
        mimeType: "image/png",
        url: `/api/files/${comment.attachments[0]}`,
      });
    }
  });

  it("hands a comment's files to an agent: listed by feedback_get, read by feedback_attachment_get", async () => {
    const {
      feedbackApi,
      feedbackTools,
      commentApi,
      call,
      asUser,
      report,
      project,
      REPORTER,
    } = await setup();
    const item = await report("It crashes");
    const other = await report("Something else");
    const uploaded = await asUser(REPORTER, () =>
      feedbackApi.uploadFeedbackAttachment({
        params: { projectId: project.id },
        body: { file: png("answer.png") },
      }),
    );
    await asUser(REPORTER, () =>
      commentApi.createFeedbackComment({
        params: { id: item.id },
        body: { body: "Here", attachments: [uploaded.id] },
      }),
    );

    const got: any = await call(feedbackTools.feedback_get, {
      project: project.id,
      id: item.id,
    });
    expect(got.discussion[0].attachments).toEqual([
      {
        id: uploaded.id,
        name: "answer.png",
        mimeType: "image/png",
        size: PNG.length,
      },
    ]);

    const content: any = await call(feedbackTools.feedback_attachment_get, {
      project: project.id,
      id: item.id,
      attachmentId: uploaded.id,
    });
    expect(JSON.stringify(content)).toContain("image/png");

    // The guard still binds the file to its own item's thread.
    await expect(
      call(feedbackTools.feedback_attachment_get, {
        project: project.id,
        id: other.id,
        attachmentId: uploaded.id,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("refuses somebody else's upload, and an empty comment", async () => {
    const {
      feedbackApi,
      commentApi,
      asUser,
      report,
      project,
      OWNER,
      REPORTER,
    } = await setup();
    const item = await report("It crashes");
    const ownersFile = await asUser(OWNER, () =>
      feedbackApi.uploadFeedbackAttachment({
        params: { projectId: project.id },
        body: { file: png() },
      }),
    );

    await expect(
      asUser(REPORTER, () =>
        commentApi.createFeedbackComment({
          params: { id: item.id },
          body: { body: "look", attachments: [ownersFile.id] },
        }),
      ),
    ).rejects.toThrow(/attachments are invalid/);
    await expect(
      asUser(REPORTER, () =>
        commentApi.createFeedbackComment({
          params: { id: item.id },
          body: { body: "  " },
        }),
      ),
    ).rejects.toThrow(/body or an attachment/);
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
