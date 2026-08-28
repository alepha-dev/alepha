import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { FeedbackController } from "../src/api/controllers/FeedbackController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

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
    { body: { title: "Feedback Source Test" } },
    { user },
  );
  return created.data.id;
};

describe("feedback source field", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("accepts a first-party submit with no source (source stays null)", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    const created = await ctx.feedbackController.submitFeedback.fetch(
      {
        params: { projectId },
        body: { title: "First-party bug", description: "Something broke" },
      },
      { user: owner },
    );

    const detail = await ctx.feedbackController.getFeedback.fetch(
      { params: { projectId, feedbackId: created.data.id } },
      { user: owner },
    );
    expect(detail.data.source ?? null).toBeNull();
  });

  it("stores the source block when supplied", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const sigilId = crypto.randomUUID();

    const created = await ctx.feedbackController.submitFeedback.fetch(
      {
        params: { projectId },
        body: {
          title: "Embedded bug",
          description: "From a partner site",
          source: {
            sigilId,
            hostUrl: "https://shop.example.com/checkout",
            hostPath: "/checkout",
            userAgent: "Mozilla/5.0",
            consoleTail: ["TypeError: x is undefined"],
          },
        },
      },
      { user: owner },
    );

    const detail = await ctx.feedbackController.getFeedback.fetch(
      { params: { projectId, feedbackId: created.data.id } },
      { user: owner },
    );
    expect(detail.data.source?.sigilId).toBe(sigilId);
    expect(detail.data.source?.hostUrl).toBe(
      "https://shop.example.com/checkout",
    );
  });

  it("persists the full page-context source with no sigilId (sigil-button flow)", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    const created = await ctx.feedbackController.submitFeedback.fetch(
      {
        params: { projectId },
        body: {
          title: "Embedded bug",
          description: "From a partner site",
          // The sigil-button flow never carries the secret sigil id.
          source: {
            hostUrl: "https://shop.example.com/checkout",
            hostPath: "/checkout",
            title: "Checkout — Step 2",
            referrer: "https://google.com/",
            userAgent: "Mozilla/5.0",
            language: "en-US",
            viewport: "1280x720",
            screen: "1920x1080",
            timezone: "Europe/Paris",
          },
        },
      },
      { user: owner },
    );

    const detail = await ctx.feedbackController.getFeedback.fetch(
      { params: { projectId, feedbackId: created.data.id } },
      { user: owner },
    );

    const source = detail.data.source;
    expect(source?.sigilId ?? null).toBeNull();
    expect(source?.hostUrl).toBe("https://shop.example.com/checkout");
    expect(source?.title).toBe("Checkout — Step 2");
    expect(source?.referrer).toBe("https://google.com/");
    expect(source?.language).toBe("en-US");
    expect(source?.viewport).toBe("1280x720");
    expect(source?.screen).toBe("1920x1080");
    expect(source?.timezone).toBe("Europe/Paris");
  });

  it("strips the query string and fragment from the two URL fields", async ({
    expect,
  }) => {
    // The sigil button scrubs both before the popup opens, so a current
    // bundle never sends this. An older one, sitting on a page this app
    // cannot redeploy, does, and the record it writes is readable by every
    // project member and survives the retention sweep once resolved.
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    const created = await ctx.feedbackController.submitFeedback.fetch(
      {
        params: { projectId },
        body: {
          title: "Reset is broken",
          description: "Sent from a page holding a one-time token",
          source: {
            hostUrl: "https://shop.example.com/reset?token=abc123#at=xyz789",
            hostPath: "/reset?token=abc123",
            userAgent: "Chrome 141 on macOS",
          },
        },
      },
      { user: owner },
    );

    const detail = await ctx.feedbackController.getFeedback.fetch(
      { params: { projectId, feedbackId: created.data.id } },
      { user: owner },
    );

    const source = detail.data.source;
    expect(source?.hostUrl).toBe("https://shop.example.com/reset");
    expect(source?.hostPath).toBe("/reset");
    expect(JSON.stringify(source)).not.toContain("abc123");
    expect(JSON.stringify(source)).not.toContain("xyz789");
  });
});
