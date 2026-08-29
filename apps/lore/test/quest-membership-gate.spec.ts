import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer, BadRequestError, ForbiddenError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { QuestController } from "../src/api/controllers/QuestController.ts";
import type { Project } from "../src/api/entities/projects.ts";
import { LoreApi } from "../src/api/index.ts";
import {
  createTestMember,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

/**
 * The membership gate on `QuestController`, one case per SHAPE rather than
 * one per endpoint.
 *
 * Fourteen hand-written `assertMember` calls moved into `use:` arrays when
 * this controller was ported to `$ownsProject`, and a gate that silently
 * stopped running would take nothing else with it: every other spec in the
 * suite calls these actions as a member, so all of them stay green whether
 * strangers are refused or waved through. This file is the one that would
 * go red.
 *
 * `security-public-project.spec.ts` covers the same ground over real HTTP
 * for `ProjectController` and never reaches this controller.
 */

interface TestContext {
  alepha: Alepha;
  controller: QuestController;
  repos: TestEntityRepositories;
}

/**
 * Pinned `DATABASE_URL`, like every other lore spec: the ROOT vitest config
 * points it at Postgres, which this app's SQLite provider refuses outright.
 */
const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreApi);

  const repos = alepha.inject(TestEntityRepositories);

  await alepha.start();

  return { alepha, controller: alepha.inject(QuestController), repos };
};

const ownerToken = (project: Project): UserAccountToken => ({
  id: project.createdBy,
  roles: ["user"],
});

const strangerToken = (): UserAccountToken => ({
  id: crypto.randomUUID(),
  roles: ["user"],
});

const memberToken = async (
  ctx: TestContext,
  project: Project,
): Promise<UserAccountToken> => {
  const user = await ctx.repos.users.create({});
  await createTestMember(ctx.alepha, project, user.id, { owner: false });
  return { id: user.id, roles: ["user"] };
};

describe("QuestController membership gate", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("refuses a stranger reading the quest list (params)", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);

    await expect(
      ctx.controller.getQuests(
        { params: { projectId: project.id }, query: {} },
        { user: strangerToken() },
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("refuses a stranger counting open quests (params)", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);

    await expect(
      ctx.controller.countOpenQuests(
        { params: { projectId: project.id } },
        { user: strangerToken() },
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("refuses a stranger listing tags (query)", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);

    await expect(
      ctx.controller.listQuestTags(
        { query: { projectId: project.id } },
        { user: strangerToken() },
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("refuses a stranger creating a quest (body)", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);

    await expect(
      ctx.controller.createQuest(
        {
          body: {
            projectId: project.id,
            title: "Trespass",
            area: "general",
            priority: "medium",
          },
        },
        { user: strangerToken() },
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("refuses a stranger reading one quest (hop)", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const quest = await createTestQuest(ctx.alepha, project);

    await expect(
      ctx.controller.getQuestById(
        { params: { id: quest.id } },
        { user: strangerToken() },
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("refuses a member of a DIFFERENT project (hop)", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const quest = await createTestQuest(ctx.alepha, project);
    const other = await createTestProject(ctx.alepha);
    const user = await memberToken(ctx, other);

    await expect(
      ctx.controller.getQuestById({ params: { id: quest.id } }, { user }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("refuses a stranger on a lifecycle transition (hop, transactional)", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const quest = await createTestQuest(ctx.alepha, project);

    await expect(
      ctx.controller.acceptQuest(
        { params: { id: quest.id } },
        { user: strangerToken() },
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("gates a quest read on the project, not on the reader having created it", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const quest = await createTestQuest(ctx.alepha, project);
    const user = await memberToken(ctx, project);

    const result = await ctx.controller.getQuestById(
      { params: { id: quest.id } },
      { user },
    );

    expect(result.id).toBe(quest.id);
  });

  it("still answers 400, not 403, when a MEMBER hits a wrong status", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const quest = await createTestQuest(ctx.alepha, project);
    const user = await memberToken(ctx, project);

    // The precondition check is what `getQuestForTransition` kept once the
    // gate took over membership. A 403 here would mean the gate swallowed
    // it; a 404 would mean the row lookup came back empty, which is the
    // failure the helper was written to stop reporting.
    await expect(
      ctx.controller.abandonQuest({ params: { id: quest.id } }, { user }),
    ).rejects.toThrow(BadRequestError);
  });

  it("keeps the feedback link owner-only for a plain member", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const user = await memberToken(ctx, project);

    // The rule hidden inside `createQuest`: membership is the gate, linking
    // to a feedback item is the project owner's alone. It reads `project`
    // from the gate now, and deleting the assert without reading past it
    // would have left that undefined.
    await expect(
      ctx.controller.createQuest(
        {
          body: {
            projectId: project.id,
            title: "Linked",
            area: "general",
            priority: "medium",
            feedbackId: 1,
          },
        },
        { user },
      ),
    ).rejects.toThrow("Only the project owner can link a quest to a feedback");
  });

  it("lets the owner past that rule, and fails on the feedback item instead", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);

    // Same call as above, made by the creator: it gets past the owner check
    // and dies on the feedback id being fictional. That is what proves the
    // first test failed for the OWNERSHIP reason and not because every
    // `feedbackId` is refused.
    await expect(
      ctx.controller.createQuest(
        {
          body: {
            projectId: project.id,
            title: "Linked",
            area: "general",
            priority: "medium",
            feedbackId: 1,
          },
        },
        { user: ownerToken(project) },
      ),
    ).rejects.toThrow("Feedback not found in this project");
  });
});
