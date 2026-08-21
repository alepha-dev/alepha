import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { QuestTools } from "../src/mcp/tools/QuestTools.ts";

/**
 * The commit trail: "what shipped for #16" as a field on the quest rather
 * than a grep of the git log for its number.
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

  const questTools = alepha.inject(QuestTools);
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const OWNER = owner.id;

  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] } as any);
      return fn();
    });

  // mirrors quest-tools-comments.spec.ts's own tool-execute helper
  const call = (tool: any, params: Record<string, unknown>, userId = OWNER) =>
    asUser(userId, () => tool.execute(params));

  const project = await asUser(OWNER, () =>
    projectApi.createProject({ body: { title: "Test" } } as any),
  );

  const forge = (accept = false) =>
    call(questTools.quest_create, {
      project: project.id,
      title: "Wire the pipeline",
      description: "x",
      area: "core",
      priority: "medium",
      accept,
    });

  return { questTools, project, call, forge, OWNER };
};

describe("Lore MCP: quest commit trail", () => {
  it("records a commit and reads it back on quest_get", async () => {
    const { questTools, project, call, forge } = await setup();
    const quest = await forge();

    const result = await call(questTools.quest_commit_add, {
      id: quest.id,
      sha: "448808EB4",
      message: "feat(lore): wire the pipeline",
      repo: "feunard/alepha",
    });

    // Normalized to lowercase: git prints shas that way, and a trail
    // carrying one commit under two casings is worse than useless.
    expect(result.commits).toHaveLength(1);
    expect(result.commits[0].sha).toBe("448808eb4");
    expect(result.commits[0].message).toBe("feat(lore): wire the pipeline");
    expect(result.commits[0].repo).toBe("feunard/alepha");
    expect(result.commits[0].at).toBeTruthy();

    const read = await call(questTools.quest_get, { id: quest.id });
    expect(read.commits).toHaveLength(1);

    const list = await call(questTools.quest_list, { project: project.id });
    expect(list.quests[0].commitCount).toBe(1);
  });

  it("is empty rather than absent on a quest nothing shipped for", async () => {
    const { questTools, project, call, forge } = await setup();
    await forge();

    const list = await call(questTools.quest_list, { project: project.id });
    expect(list.quests[0].commitCount).toBe(0);
  });

  it("dedupes on the sha, whatever the casing", async () => {
    const { questTools, call, forge } = await setup();
    const quest = await forge();

    await call(questTools.quest_commit_add, {
      id: quest.id,
      sha: "448808eb4",
    });
    const again = await call(questTools.quest_commit_add, {
      id: quest.id,
      sha: "448808EB4",
      message: "same commit, shouting",
    });

    expect(again.commits).toHaveLength(1);
    // The first record wins: a repeat is a no-op, not an overwrite.
    expect(again.commits[0].message).toBeUndefined();
  });

  it("refuses something that is not a sha", async () => {
    const { questTools, call, forge } = await setup();
    const quest = await forge();

    await expect(
      call(questTools.quest_commit_add, { id: quest.id, sha: "not-a-sha" }),
    ).rejects.toThrow();
  });

  it("accepts commits at completion and afterwards", async () => {
    const { questTools, call, forge } = await setup();
    const quest = await forge(true);

    await call(questTools.quest_complete, {
      id: quest.id,
      message: "shipped",
      commits: [{ sha: "aaaaaaa", message: "the main change" }],
    });

    // The sha that only turns up after the merge, recorded on a quest that
    // is already closed.
    const later = await call(questTools.quest_commit_add, {
      id: quest.id,
      sha: "bbbbbbb",
      message: "the follow-up fix",
    });

    expect(later.commits.map((c: any) => c.sha)).toEqual([
      "aaaaaaa",
      "bbbbbbb",
    ]);
  });
});
