import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { feedbackOptionsAtom } from "../src/api/atoms/feedbackOptionsAtom.ts";
import { FeedbackController } from "../src/api/controllers/FeedbackController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * The feedback list pages (#1744, from feedback #2076: "add LIMIT to 10 +
 * show more, it's useless to display all"). It used to return every row for
 * the selected status: 106 of them on project 1, each dragging its
 * attachment ids into the same statement that had already tripped D1's
 * 100-parameter ceiling in #1730.
 *
 * The page is server-side rather than a client-side slice, so the pinning
 * belongs here: a `limit` the endpoint ignores would look identical in the
 * UI until the inbox grew.
 *
 * `countFeedback` is the other half. The sidebar badge used to be
 * `listFeedback().items.length`, which is the same number only while the
 * list is unbounded - the whole reason it needed an endpoint of its own.
 */

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

const TOTAL = 23;

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

  // The production cap is five a day, which is below what a paging fixture
  // needs and is not what is under test.
  const options = alepha.store.get(feedbackOptionsAtom);
  alepha.store.set(feedbackOptionsAtom, {
    ...options,
    maxFeedbackPerUserPerDay: TOTAL + 1,
  });

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

describe("feedback list pagination", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const seed = async () => {
    const owner = await createTestUser(ctx);
    const projectId = (
      await ctx.projectController.createProject.fetch(
        {
          body: {
            title: "Paging",
            capabilities: [{ key: "support" as const }],
          },
        },
        { user: owner },
      )
    ).data.id;

    for (let i = 1; i <= TOTAL; i++) {
      await ctx.feedbackController.submitFeedback.fetch(
        {
          params: { projectId },
          body: { title: `Report ${i}`, description: `body ${i}` },
        },
        { user: owner },
      );
    }

    return { owner, projectId };
  };

  it("answers ten by default and says whether more remain", async ({
    expect,
  }) => {
    const { owner, projectId } = await seed();

    const first = await ctx.feedbackController.listFeedback.fetch(
      { params: { projectId }, query: {} },
      { user: owner },
    );

    expect(first.data.items).toHaveLength(10);
    expect(first.data.hasMore).toBe(true);
  });

  it("walks the whole set through offset, without gaps or repeats", async ({
    expect,
  }) => {
    const { owner, projectId } = await seed();

    const seen: number[] = [];
    let offset = 0;
    let hasMore = true;
    let pages = 0;

    while (hasMore) {
      const page = await ctx.feedbackController.listFeedback.fetch(
        { params: { projectId }, query: { limit: 10, offset } },
        { user: owner },
      );
      seen.push(...page.data.items.map((item) => item.shortId));
      hasMore = page.data.hasMore;
      offset += 10;
      pages += 1;
      // A `hasMore` that never clears would spin here rather than fail.
      expect(pages).toBeLessThanOrEqual(5);
    }

    expect(pages).toBe(3);
    expect(seen).toHaveLength(TOTAL);
    expect(new Set(seen).size).toBe(TOTAL);
    // Newest first, unchanged from before paging - and the order is what
    // makes offset paging coherent at all.
    expect(seen).toEqual([...seen].sort((a, b) => b - a));
    expect(seen[0]).toBe(TOTAL);
  });

  it("clears hasMore on an exact final page", async ({ expect }) => {
    const { owner, projectId } = await seed();

    // The off-by-one that an over-fetch is there to get right: with the
    // window ending exactly on the last row, `hasMore` must be false.
    const exact = await ctx.feedbackController.listFeedback.fetch(
      { params: { projectId }, query: { limit: 13, offset: 10 } },
      { user: owner },
    );

    expect(exact.data.items).toHaveLength(13);
    expect(exact.data.hasMore).toBe(false);
  });

  it("counts the whole set, not the page", async ({ expect }) => {
    const { owner, projectId } = await seed();

    const pending = await ctx.feedbackController.countFeedback.fetch(
      { params: { projectId }, query: { status: "pending" } },
      { user: owner },
    );

    expect(pending.data.count).toBe(TOTAL);

    // And it follows a triage decision rather than the page it is beside.
    const [first] = (
      await ctx.feedbackController.listFeedback.fetch(
        { params: { projectId }, query: {} },
        { user: owner },
      )
    ).data.items;
    await ctx.feedbackController.rejectFeedback.fetch(
      { params: { projectId, feedbackId: first.id } },
      { user: owner },
    );

    const after = await ctx.feedbackController.countFeedback.fetch(
      { params: { projectId }, query: { status: "pending" } },
      { user: owner },
    );
    const rejected = await ctx.feedbackController.countFeedback.fetch(
      { params: { projectId }, query: { status: "rejected" } },
      { user: owner },
    );

    expect(after.data.count).toBe(TOTAL - 1);
    expect(rejected.data.count).toBe(1);
  });
});
