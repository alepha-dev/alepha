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

import { LorePlanApi } from "../src/api/index.ts";
import { EpicTools, LorePlanMcp, QuestTools } from "../src/mcp/index.ts";

/**
 * The pull request trail (#Q3707): the pull request a quest or an epic
 * shipped through, recorded like a commit rather than posted as a link in
 * the discussion. Same identity shim as `quest-tools-commits.spec.ts`.
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
  alepha.with(LorePlanApi);
  alepha.with(LorePlanMcp);

  const questTools = alepha.inject(QuestTools);
  const epicTools = alepha.inject(EpicTools);
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });

  const call = (tool: any, params: Record<string, unknown>) =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: owner.id, roles: ["user"] });
      return tool.execute(params);
    });

  const project = await call(
    { execute: () => projectApi.createProject({ body: { title: "Test" } }) },
    {},
  );

  const forge = (extra: Record<string, unknown> = {}) =>
    call(questTools.quest_create, {
      project: project.id,
      title: "Wire the pipeline",
      description: "x",
      area: "core",
      priority: "medium",
      ...extra,
    });

  const readyEpic = async () => {
    const epic = await call(epicTools.epic_create, {
      project: project.id,
      title: "One pull request",
    });
    await call(epicTools.epic_set_status, {
      project: project.id,
      number: epic.number,
      status: "ready",
    });
    return epic;
  };

  return { alepha, questTools, epicTools, project, call, forge, readyEpic };
};

const URL_118 = "https://github.com/acme/crm/pull/118";

describe("pull requests on a quest", () => {
  it("records one and reads it back on quest_get", async () => {
    const { questTools, call, forge } = await setup();
    const quest = await forge();

    const result = await call(questTools.quest_pull_request_add, {
      id: quest.id,
      url: URL_118,
      pr_number: 118,
      repo: "acme/crm",
      title: "feat: wire the pipeline",
    });

    expect(result.pullRequests).toEqual([
      {
        url: URL_118,
        number: 118,
        repo: "acme/crm",
        title: "feat: wire the pipeline",
        at: expect.any(String),
      },
    ]);

    const read = await call(questTools.quest_get, { id: quest.id });
    expect(read.pullRequests).toHaveLength(1);
    expect(read.pullRequests[0].url).toBe(URL_118);
    expect(read.epicPullRequests).toBeUndefined();
  });

  it("is empty rather than absent on a quest with none", async () => {
    const { questTools, call, forge } = await setup();
    const quest = await forge();

    const read = await call(questTools.quest_get, { id: quest.id });
    expect(read.pullRequests).toEqual([]);
  });

  it("dedupes on the url, whatever its casing or trailing slash", async () => {
    const { questTools, call, forge } = await setup();
    const quest = await forge();

    await call(questTools.quest_pull_request_add, {
      id: quest.id,
      url: URL_118,
    });
    const again = await call(questTools.quest_pull_request_add, {
      id: quest.id,
      url: `${URL_118.replace("acme", "ACME")}/`,
      title: "the same one, shouting",
    });

    expect(again.pullRequests).toHaveLength(1);
    // The first record wins: a repeat is a no-op, not an overwrite.
    expect(again.pullRequests[0].title).toBeUndefined();
  });

  it("refuses a url that is not http or https", async () => {
    const { questTools, call, forge } = await setup();
    const quest = await forge();

    await expect(
      call(questTools.quest_pull_request_add, {
        id: quest.id,
        url: "javascript:alert(1)",
      }),
    ).rejects.toThrow();
  });

  it("records one on a completed quest", async () => {
    const { questTools, call, forge } = await setup();
    const quest = await forge({ accept: true });
    await call(questTools.quest_complete, { id: quest.id, message: "done" });

    const later = await call(questTools.quest_pull_request_add, {
      id: quest.id,
      url: URL_118,
    });

    expect(later.pullRequests).toHaveLength(1);
  });
});

describe("pull requests on an epic", () => {
  it("records one, in a completed epic too, and epic_get returns it", async () => {
    const { questTools, epicTools, project, call, forge, readyEpic } =
      await setup();
    const epic = await readyEpic();
    const quest = await forge({ epic_number: epic.number, accept: true });
    await call(questTools.quest_complete, { id: quest.id, message: "done" });

    const before = await call(epicTools.epic_get, {
      project: project.id,
      number: epic.number,
    });
    expect(before.status).toBe("completed");
    expect(before.pullRequests).toEqual([]);

    const result = await call(epicTools.epic_pull_request_add, {
      project: project.id,
      number: epic.number,
      url: URL_118,
      pr_number: 118,
    });
    expect(result.number).toBe(epic.number);
    expect(result.pullRequests).toHaveLength(1);
    expect(result.pullRequests[0].number).toBe(118);

    const again = await call(epicTools.epic_pull_request_add, {
      project: project.id,
      number: epic.number,
      url: URL_118,
    });
    expect(again.pullRequests).toHaveLength(1);

    const read = await call(epicTools.epic_get, {
      project: project.id,
      number: epic.number,
    });
    expect(read.pullRequests.map((pr: any) => pr.url)).toEqual([URL_118]);
  });

  it("is shown on a quest of the epic that has none of its own", async () => {
    const { questTools, epicTools, project, call, forge, readyEpic } =
      await setup();
    const epic = await readyEpic();
    const quest = await forge({ epic_number: epic.number });
    await call(epicTools.epic_pull_request_add, {
      project: project.id,
      number: epic.number,
      url: URL_118,
    });

    const read = await call(questTools.quest_get, { id: quest.id });
    expect(read.pullRequests).toEqual([]);
    expect(read.epicPullRequests?.map((pr: any) => pr.url)).toEqual([URL_118]);
  });

  it("is not shown on a quest of the epic that has its own", async () => {
    const { questTools, epicTools, project, call, forge, readyEpic } =
      await setup();
    const epic = await readyEpic();
    const quest = await forge({ epic_number: epic.number });
    await call(epicTools.epic_pull_request_add, {
      project: project.id,
      number: epic.number,
      url: URL_118,
    });
    await call(questTools.quest_pull_request_add, {
      id: quest.id,
      url: "https://github.com/acme/crm/pull/119",
    });

    const read = await call(questTools.quest_get, { id: quest.id });
    expect(read.pullRequests.map((pr: any) => pr.url)).toEqual([
      "https://github.com/acme/crm/pull/119",
    ]);
    expect(read.epicPullRequests).toBeUndefined();
  });
});
