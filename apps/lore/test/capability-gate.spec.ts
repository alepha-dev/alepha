import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { FolioController } from "../src/api/controllers/FolioController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QualityController } from "../src/api/controllers/QualityController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";
import { ProjectSecurityService } from "../src/api/services/ProjectSecurityService.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { QuestTools } from "../src/mcp/tools/QuestTools.ts";

/**
 * The capability gate, from all three sides it is reached from.
 *
 * The refusal is a **400 naming the capability and the fix**, not a 403 and
 * not a 404. A page under a disabled capability does not exist, so the router
 * answers 404; an API call into one is a request the project understands and
 * declines. Both shapes already existed in this tree, and what was missing was
 * writing down which applies where — so this file pins it, because a refusal
 * an agent cannot act on is a refusal it will retry forever.
 *
 * ⚠️ The machine-writer exemption is the case worth the most here. Sigil
 * ingest, artifact push and quality push are accepted whatever the switches
 * say, because a toggle in somebody's project settings must never turn
 * somebody else's build red. They are exempt by construction rather than by an
 * exception in the gate — none of the three goes through `$ownsProject`, each
 * holds its own credential — and construction is exactly the kind of guarantee
 * that quietly stops being true.
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

  const projectApi = alepha.inject(ProjectController);
  const questApi = alepha.inject(QuestController);
  const folioApi = alepha.inject(FolioController);
  const qualityApi = alepha.inject(QualityController);
  const questTools = alepha.inject(QuestTools);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });

  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, {
        id: userId,
        roles: ["user"],
      } as never);
      return fn();
    });

  return {
    alepha,
    projectApi,
    questApi,
    folioApi,
    qualityApi,
    questTools,
    owner,
    asUser,
  };
};

describe("the capability gate", () => {
  it("refuses a quest write with a 400 naming the capability and the fix", async ({
    expect,
  }) => {
    const ctx = await setup();
    const project = await ctx.asUser(ctx.owner.id, () =>
      ctx.projectApi.createProject({
        body: { title: "NoWork", capabilities: [{ key: "knowledge" }] },
      }),
    );

    await expect(
      ctx.asUser(ctx.owner.id, () =>
        ctx.questApi.createQuest({
          body: {
            projectId: project.id,
            title: "Should not exist",
            description: "",
            area: "general",
            priority: "medium",
          },
        } as never),
      ),
    ).rejects.toThrow(/Plan and track work.*Turn it on in Settings/s);

    await ctx.alepha.stop();
  });

  it("lets the same write through once the capability is on", async ({
    expect,
  }) => {
    const ctx = await setup();
    const project = await ctx.asUser(ctx.owner.id, () =>
      ctx.projectApi.createProject({
        body: { title: "HasWork", capabilities: [{ key: "work" }] },
      }),
    );

    const quest = await ctx.asUser(ctx.owner.id, () =>
      ctx.questApi.createQuest({
        body: {
          projectId: project.id,
          title: "Real quest",
          description: "",
          area: "general",
          priority: "medium",
        },
      } as never),
    );

    expect(quest.title).toBe("Real quest");
    await ctx.alepha.stop();
  });

  it("leaves reads open, because disabling hides and never deletes", async ({
    expect,
  }) => {
    const ctx = await setup();
    const project = await ctx.asUser(ctx.owner.id, () =>
      ctx.projectApi.createProject({
        body: { title: "Hidden", capabilities: [{ key: "work" }] },
      }),
    );
    await ctx.asUser(ctx.owner.id, () =>
      ctx.questApi.createQuest({
        body: {
          projectId: project.id,
          title: "Still here",
          description: "",
          area: "general",
          priority: "medium",
        },
      } as never),
    );

    // Turn Work off the way Settings does: the row goes, and nothing else.
    const security = ctx.alepha.inject(ProjectSecurityService);
    const row = await security.capabilities.findOne({
      where: { projectId: { eq: project.id }, key: { eq: "work" } },
    });
    await security.capabilities.deleteById(row!.id);

    const quests = await ctx.asUser(ctx.owner.id, () =>
      ctx.questApi.getQuests({
        params: { projectId: project.id },
        query: {},
      } as never),
    );

    // The whole "hides, never deletes" rule in one assertion: the read still
    // answers, and it answers with the quest. A project that turns Work back
    // on finds it exactly where it left it.
    expect(quests.content.map((q) => q.title)).toContain("Still here");

    await ctx.alepha.stop();
  });

  it("refuses a folio write on a project without Knowledge", async ({
    expect,
  }) => {
    const ctx = await setup();
    const project = await ctx.asUser(ctx.owner.id, () =>
      ctx.projectApi.createProject({
        body: { title: "NoKnowledge", capabilities: [{ key: "work" }] },
      }),
    );

    await expect(
      ctx.asUser(ctx.owner.id, () =>
        ctx.folioApi.create({
          body: { projectId: project.id, title: "Nope", content: "" },
        } as never),
      ),
    ).rejects.toThrow(/Write and keep knowledge/);

    await ctx.alepha.stop();
  });

  it("refuses an MCP call into a disabled capability", async ({ expect }) => {
    const ctx = await setup();
    const project = await ctx.asUser(ctx.owner.id, () =>
      ctx.projectApi.createProject({
        body: { title: "McpNoWork", capabilities: [{ key: "knowledge" }] },
      }),
    );

    // The question this case exists to settle: whether a tool calling a
    // controller action IN PROCESS still runs the action's `use:` chain. If it
    // did not, every MCP write would be an unguarded door beside a guarded
    // one, and the tools would each need the gate by hand.
    await expect(
      ctx.asUser(ctx.owner.id, () =>
        ctx.questTools.quest_create.execute({
          project: project.id,
          title: "Should not exist",
          area: "general",
          description: "",
          priority: "medium",
        } as never),
      ),
    ).rejects.toThrow(/Plan and track work/);

    await ctx.alepha.stop();
  });

  it("accepts a quality push whatever the switches say", async ({ expect }) => {
    const ctx = await setup();
    const project = await ctx.asUser(ctx.owner.id, () =>
      ctx.projectApi.createProject({ body: { title: "CiPush" } }),
    );

    // No capabilities at all, and CI still gets its 200. A switch in the UI
    // must never be able to turn someone's build red — the same rule artifact
    // push and sigil ingest already hold, and the reason Quality has no
    // switch of its own any more.
    const pushed = await ctx.asUser(ctx.owner.id, () =>
      ctx.qualityApi.pushQualityRun({
        params: { projectId: project.id },
        body: {
          branch: "main",
          commitSha: "abc1234",
          coverage: {
            lines: 80,
            statements: 80,
            functions: 80,
            branches: 80,
          },
          tests: { total: 10, passed: 10, failed: 0, skipped: 0 },
          durationMs: 1234,
        },
      } as never),
    );

    expect(pushed).toBeTruthy();
    await ctx.alepha.stop();
  });
});
