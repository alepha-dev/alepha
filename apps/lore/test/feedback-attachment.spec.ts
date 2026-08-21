import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { FeedbackController } from "../src/api/controllers/FeedbackController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

// 1x1 transparent PNG.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  feedbackController: FeedbackController;
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
    feedbackController: alepha.inject(FeedbackController),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (
  ctx: TestContext,
): Promise<{ id: string; roles: string[] }> => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

const createProject = async (
  ctx: TestContext,
  user: { id: string; roles: string[] },
): Promise<number> => {
  const created = await ctx.projectController.createProject.fetch(
    { body: { title: "Attachment Test" } },
    { user },
  );
  return created.data.id;
};

/**
 * Upload a PNG attachment as `user`, then submit feedback that claims it.
 * Returns `{ feedbackId, attachmentId }`.
 */
const submitWithAttachment = async (
  ctx: TestContext,
  projectId: number,
  user: { id: string; roles: string[] },
): Promise<{ feedbackId: number; attachmentId: string }> => {
  const upload = await ctx.feedbackController.uploadFeedbackAttachment.fetch(
    {
      params: { projectId },
      body: {
        file: new File([PNG_BYTES], "screenshot.png", { type: "image/png" }),
      },
    },
    { user },
  );
  const submitted = await ctx.feedbackController.submitFeedback.fetch(
    {
      params: { projectId },
      body: {
        title: "Bug with a screenshot",
        description: "See attached",
        attachments: [upload.data.id],
      },
    },
    { user },
  );
  return { feedbackId: submitted.data.id, attachmentId: upload.data.id };
};

describe("getFeedbackAttachment", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("returns the attachment bytes (base64) and metadata to a project member", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const { feedbackId, attachmentId } = await submitWithAttachment(
      ctx,
      projectId,
      owner,
    );

    const res = await ctx.feedbackController.getFeedbackAttachment.fetch(
      { params: { projectId, feedbackId, attachmentId } },
      { user: owner },
    );

    expect(res.data.id).toBe(attachmentId);
    expect(res.data.name).toBe("screenshot.png");
    expect(res.data.mimeType).toBe("image/png");
    // Bytes round-trip exactly.
    expect(Buffer.from(res.data.data, "base64").equals(PNG_BYTES)).toBe(true);
  });

  it("surfaces the attachment via feedback_get's attachments list", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const { feedbackId, attachmentId } = await submitWithAttachment(
      ctx,
      projectId,
      owner,
    );

    const detail = await ctx.feedbackController.getFeedback.fetch(
      { params: { projectId, feedbackId } },
      { user: owner },
    );

    const urls = detail.data.attachmentUrls ?? [];
    expect(urls.map((a) => a.id)).toContain(attachmentId);
    expect(urls[0].mimeType).toBe("image/png");
  });

  it("IDOR guard: 404 when the attachment does not belong to that feedback", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    // Two feedback, each with its own attachment.
    const first = await submitWithAttachment(ctx, projectId, owner);
    const second = await submitWithAttachment(ctx, projectId, owner);

    // Ask for feedback #1 but with feedback #2's attachment id → must 404.
    const error = await ctx.feedbackController.getFeedbackAttachment
      .fetch(
        {
          params: {
            projectId,
            feedbackId: first.feedbackId,
            attachmentId: second.attachmentId,
          },
        },
        { user: owner },
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
  });

  it("rejects a non-member trying to read an attachment", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const outsider = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const { feedbackId, attachmentId } = await submitWithAttachment(
      ctx,
      projectId,
      owner,
    );

    const error = await ctx.feedbackController.getFeedbackAttachment
      .fetch(
        { params: { projectId, feedbackId, attachmentId } },
        { user: outsider },
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    // ensureMember throws 403/404 for non-members — either way, not a 200.
    expect([403, 404]).toContain((error as HttpError).status);
  });
});
