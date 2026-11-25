import {
  ChatAgentController,
  ChatAgentRunner,
  ChatMessageController,
  ChatRoomController,
  chatAgentCharges,
} from "@lore/chat/api";
import { ProjectSecurityService } from "@lore/core/api";
import {
  createTestMemberByProjectId,
  createTestProject,
} from "@lore/core/testing";
import { AiSettings, aiMessageEntity } from "alepha/api/ai";
import { RankService } from "alepha/api/organizations";
import { ParameterProvider } from "alepha/api/parameters";
import { $repository } from "alepha/orm";
import { describe, it } from "vitest";

import { LoreAiBudget } from "@/assistant/index.ts";

import { bootAssistant } from "./fixtures/bootAssistant.ts";

/**
 * A provider that can drop what it cached, as a Worker isolate that never
 * loaded `api.ai` has nothing cached: the saved value is in the database
 * only (#Q4244).
 */
class ForgetfulParameterProvider extends ParameterProvider {
  public forget(): void {
    this.cachedCurrent.clear();
    this.cachedNext.clear();
    this.loaded.clear();
    this.loadedAt.clear();
  }
}

class Repos {
  charges = $repository(chatAgentCharges);
  messages = $repository(aiMessageEntity);
}

/**
 * A project's AI budget for its chat agents (#Q4237): a run draws on it
 * first and falls back to the mentioner's own; the project's spending does
 * not count against the member; a refusal names the budget that ran out and
 * when enough frees up.
 */
describe("a project's AI budget for its chat agents", () => {
  const boot = async () => {
    const errors: string[] = [];
    const ctx = await bootAssistant({
      enabled: "1",
      extra: (alepha) => {
        alepha.with({
          provide: ParameterProvider,
          use: ForgetfulParameterProvider,
        });
        alepha.inject(Repos);
        alepha.events.on("log:entry", ({ entry }) => {
          if (entry.level === "ERROR") errors.push(String(entry.message));
        });
      },
    });
    const project = await createTestProject(ctx.alepha, {
      title: "Acme",
      capabilities: [{ key: "plan" }, { key: "chat" }],
    });
    const owner = await ctx.signIn(project.createdBy);
    const organizationId = await ctx.alepha
      .inject(ProjectSecurityService)
      .organizationIdOf(project.id);
    await ctx.alepha.inject(RankService).save(
      organizationId,
      {
        key: "talker",
        name: "Talker",
        permissions: ["project:read", "chat:read", "chat:write"],
      },
      owner.user,
    );
    const talker = await ctx.signIn();
    await createTestMemberByProjectId(ctx.alepha, project.id, talker.id, {
      rank: "talker",
    });
    const room = (
      await ctx.alepha.inject(ChatRoomController).createChatRoom.fetch(
        {
          params: { projectId: project.id },
          body: { name: "general", private: false },
        },
        { user: owner.user },
      )
    ).data;
    const messages = ctx.alepha.inject(ChatMessageController);
    const send = async (body: string) =>
      messages.sendChatMessage.fetch(
        { params: { projectId: project.id, roomId: room.id }, body: { body } },
        { user: owner.user as never },
      );
    const answers = async () =>
      (
        await messages.listChatMessages.fetch(
          { params: { projectId: project.id, roomId: room.id }, query: {} },
          { user: owner.user },
        )
      ).data.items.filter((it) => it.agent);
    const agents = ctx.alepha.inject(ChatAgentController);
    const setBudget = (tokens: number | null, as = owner.user) =>
      agents.setChatAgentBudget.fetch(
        { params: { projectId: project.id }, body: { tokens } },
        { user: as },
      );
    const budget = async () =>
      (
        await agents.getChatAgentBudget.fetch(
          { params: { projectId: project.id } },
          { user: owner.user },
        )
      ).data;
    const repos = ctx.alepha.inject(Repos);
    // A past run the project paid for: its tokens are on the member's rows,
    // and the charge says the project paid them.
    const projectPaid = async (tokens: number) => {
      const conversationId = crypto.randomUUID();
      await repos.messages.create({
        conversationId,
        userId: owner.id,
        seq: 1,
        role: "assistant",
        content: "paid by the project",
        inputTokens: tokens,
        outputTokens: 0,
      });
      await repos.charges.create({
        projectId: project.id,
        userId: owner.id,
        conversationId,
        tokens,
      });
    };
    // The owner's own budget, spent: one past turn worth all of it.
    const spendOwn = () =>
      repos.messages.create({
        conversationId: crypto.randomUUID(),
        userId: owner.id,
        seq: 1,
        role: "assistant",
        content: "earlier",
        inputTokens: 1_000_000,
        outputTokens: 0,
      });
    return {
      ...ctx,
      errors,
      project,
      owner,
      talker,
      send,
      answers,
      setBudget,
      budget,
      repos,
      spendOwn,
      projectPaid,
      runner: ctx.alepha.inject(ChatAgentRunner),
      lore: ctx.alepha.inject(LoreAiBudget),
    };
  };

  it("weighs a token read from the prompt cache at a tenth, against the member's budget and a run's charge (#Q4297)", async ({
    expect,
  }) => {
    const ctx = await boot();
    const conversationId = crypto.randomUUID();
    await ctx.repos.messages.create({
      conversationId,
      userId: ctx.owner.id,
      seq: 1,
      role: "assistant",
      content: "cached",
      // 100,000 in, 90,000 of them a cache read; 1,000 out.
      inputTokens: 100_000,
      cachedInputTokens: 90_000,
      outputTokens: 1_000,
    } as never);

    // 100,000 - 81,000 + 1,000.
    expect(await ctx.lore.remaining(ctx.owner.id)).toBe(1_000_000 - 20_000);
    expect(
      await ctx.lore.spentSince(conversationId, "2000-01-01T00:00:00.000Z"),
    ).toBe(20_000);
  });

  it("charges a run to the project, and not to the member who asked", async ({
    expect,
  }) => {
    const ctx = await boot();
    await ctx.setBudget(5_000);
    ctx.ai.script([
      { type: "text", text: "Done." },
      { type: "usage", inputTokens: 900, outputTokens: 100 },
    ]);

    await ctx.send("@lore check");
    await ctx.runner.settled();

    expect((await ctx.answers())[0]?.body).toBe("Done.");
    const charges = await ctx.repos.charges.findMany({});
    expect(charges.map((it) => it.tokens)).toEqual([1_000]);
    expect(charges[0]?.userId).toBe(ctx.owner.id);
    expect(await ctx.budget()).toMatchObject({
      tokens: 5_000,
      spent: 1_000,
      windowHours: 24,
    });
    // The member's own budget does not count what the project paid.
    expect(await ctx.lore.remaining(ctx.owner.id)).toBe(1_000_000);
  });

  it("falls back to the member's budget once the project's is spent", async ({
    expect,
  }) => {
    const ctx = await boot();
    await ctx.setBudget(1_000);
    await ctx.projectPaid(1_000);
    ctx.ai.script([
      { type: "text", text: "On you." },
      { type: "usage", inputTokens: 400, outputTokens: 100 },
    ]);

    await ctx.send("@lore check");
    await ctx.runner.settled();

    expect((await ctx.answers())[0]?.body).toBe("On you.");
    // No new charge: the member paid, and their budget shows it.
    expect(await ctx.repos.charges.findMany({})).toHaveLength(1);
    expect(await ctx.lore.remaining(ctx.owner.id)).toBe(999_500);
    expect((await ctx.budget()).freesAt).toBeDefined();
  });

  it("refuses when both are spent, naming each and when it frees up", async ({
    expect,
  }) => {
    const ctx = await boot();
    await ctx.setBudget(1_000);
    await ctx.projectPaid(1_000);
    await ctx.spendOwn();

    await ctx.send("@lore check");
    await ctx.runner.settled();

    const [answer] = await ctx.answers();
    const said = JSON.stringify(answer);
    expect(said).toContain("This project's AI budget for agents is spent");
    expect(said).toContain("1000 of 1000 tokens");
    expect(said).toContain("your own AI budget is spent too");
    expect(said).toMatch(/Enough frees up at \d{4}-\d\d-\d\d \d\d:\d\d UTC/);
    expect(ctx.ai.requests).toHaveLength(0);
    // And the project is told, through the errors inbox (#Q4298).
    expect(ctx.errors).toHaveLength(1);
    expect(ctx.errors[0]).toContain(
      "could not finish (budget) in room general",
    );
  });

  it("names the member's budget alone when the project has none", async ({
    expect,
  }) => {
    const ctx = await boot();
    await ctx.spendOwn();

    await ctx.send("@lore check");
    await ctx.runner.settled();

    const said = JSON.stringify((await ctx.answers())[0]);
    expect(said).toContain(
      "Your AI budget is spent: 1000000 of 1000000 tokens",
    );
    expect(said).toContain("Enough frees up at");
    expect(said).not.toContain("project");
  });

  it("answers under the member budget an operator saved, not the compiled 200k, in an isolate that never loaded it", async ({
    expect,
  }) => {
    const ctx = await boot();
    const settings = ctx.alepha.inject(AiSettings);
    await settings.parameter.set({
      ...settings.current,
      budgetTokens: 2_000_000,
    });
    ctx.alepha.inject(ForgetfulParameterProvider).forget();
    await ctx.spendOwn();
    ctx.ai.script([{ type: "text", text: "Still here." }]);

    await ctx.send("@lore check");
    await ctx.runner.settled();

    expect((await ctx.answers())[0]?.body).toBe("Still here.");
  });

  it("is set by a rank with chat:agent only, and removed with null", async ({
    expect,
  }) => {
    const ctx = await boot();
    await expect(ctx.setBudget(5_000, ctx.talker.user)).rejects.toThrow();
    expect((await ctx.setBudget(5_000)).data.tokens).toBe(5_000);
    expect((await ctx.setBudget(null)).data.tokens).toBeUndefined();
    expect(await ctx.budget()).toEqual({ spent: 0, windowHours: 24 });
  });
});
