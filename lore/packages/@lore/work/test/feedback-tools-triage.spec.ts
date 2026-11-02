import { ProjectController, ProjectSecurityService } from "@lore/core/api";
import { Alepha } from "alepha";
import { RankService } from "alepha/api/organizations";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake } from "alepha/testing/faker";
import { describe, expect, it } from "vitest";

import { FeedbackController } from "../src/api/index.ts";
import { LoreWorkApi } from "../src/api/index.ts";
import { FeedbackTools, LoreWorkMcp, QuestTools } from "../src/mcp/index.ts";
import { createTestMemberByProjectId } from "../src/testing/index.ts";

/**
 * Triage over MCP belongs to a permission, not to the project's owner:
 * `feedback:triage` is grantable, so a tool saying "owner-only" would send an
 * agent holding it looking for somebody else.
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
  const questTools = alepha.inject(QuestTools);
  const feedbackApi = alepha.inject(FeedbackController);
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const triager = await users.createUser({ username: "triager" });
  const member = await users.createUser({ username: "member" });

  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] });
      return fn();
    });

  const call = (tool: any, params: Record<string, unknown>, userId: string) =>
    asUser(userId, () => tool.execute(params));

  const project = await asUser(owner.id, () =>
    projectApi.createProject({
      body: {
        title: "Test",
        capabilities: [{ key: "work" }, { key: "support" }],
      },
    }),
  );

  await alepha.inject(RankService).save(
    await alepha.inject(ProjectSecurityService).organizationIdOf(project.id),
    {
      key: "triager",
      name: "Triager",
      permissions: [
        "project:read",
        "feedback:read",
        "feedback:triage",
        "quest:read",
        "quest:create",
      ],
    },
    { id: owner.id, roles: ["user"] },
  );
  await createTestMemberByProjectId(alepha, project.id, triager.id, {
    rank: "triager",
  });
  await createTestMemberByProjectId(alepha, project.id, member.id);

  const report = (title: string) =>
    asUser(owner.id, () =>
      feedbackApi.submitFeedback({
        params: { projectId: project.id },
        body: { title, description: "x" },
      }),
    );

  return {
    feedbackTools,
    questTools,
    project,
    call,
    report,
    triager,
    member,
  };
};

describe("Lore MCP: who may triage feedback", () => {
  it("is whoever holds feedback:triage, not only the owner", async () => {
    const { feedbackTools, questTools, project, call, report, triager } =
      await setup();
    const accepted = await report("It crashes");
    const rejected = await report("It is blue");

    const yes = await call(
      feedbackTools.feedback_accept,
      { project: project.id, id: accepted.id },
      triager.id,
    );
    expect(yes.ok).toBe(true);
    const no = await call(
      feedbackTools.feedback_reject,
      { project: project.id, id: rejected.id },
      triager.id,
    );
    expect(no.ok).toBe(true);

    const linked = await call(
      feedbackTools.feedback_get,
      { project: project.id, id: accepted.id },
      triager.id,
    );
    const quest = await call(
      questTools.quest_create,
      {
        project: project.id,
        title: "Fix the crash",
        description: "x",
        area: "general",
        priority: "low",
        feedback_shortId: linked.shortId,
      },
      triager.id,
    );
    expect(quest.shortId).toBeGreaterThan(0);
  });

  it("refuses a rank without it", async () => {
    const { feedbackTools, project, call, report, member } = await setup();
    const item = await report("It crashes");

    for (const tool of [
      feedbackTools.feedback_accept,
      feedbackTools.feedback_reject,
    ]) {
      await expect(
        call(tool, { project: project.id, id: item.id }, member.id),
      ).rejects.toThrow(/feedback:triage/);
    }
  });

  it("is what the tools tell an agent", async () => {
    const { feedbackTools } = await setup();

    for (const tool of [
      feedbackTools.feedback_accept,
      feedbackTools.feedback_reject,
    ]) {
      expect(tool.options.description).toContain("Needs `feedback:triage`");
    }
    expect(feedbackTools.feedback_list.options.description).toContain(
      "accept and reject need `feedback:triage`",
    );
    expect(feedbackTools.feedback_list.options.description).not.toContain(
      "owner-only",
    );
  });
});
