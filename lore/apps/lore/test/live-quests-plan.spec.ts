import { ProjectCapabilityController, ProjectController } from "@lore/core/api";
import { QuestController } from "@lore/plan/api";
import { QuestTools } from "@lore/plan/mcp";
import { quests } from "@lore/plan/schemas";
import { AppController, CommitQuestSetService } from "@lore/ship/api";
import { deployments } from "@lore/ship/schemas";
import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

class Rows {
  public readonly quests = $repository(quests);
  public readonly deployments = $repository(deployments);
}

/**
 * The quest side of live quests (#E154): the quest list's Live column and
 * its "completed, not live yet" filter, and `quest_get`'s `live`, all read
 * from Ship through core's `LiveQuestRegistry`.
 */
describe("a quest's liveness, from Plan", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaFake);
    alepha.with(AlephaMcp);
    bootLore(alepha, ["api", "mcp"]);
    alepha.with(Rows);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const sha = (seed: string) => seed.repeat(40).slice(0, 40);

  const world = async () => {
    const owner = await alepha
      .inject(UserService)
      .createUser({ username: `owner-${crypto.randomUUID().slice(0, 6)}` });
    const user = { id: owner.id, roles: ["user"] };
    const project = (
      await alepha.inject(ProjectController).createProject.fetch(
        {
          body: {
            title: `Live ${crypto.randomUUID().slice(0, 8)}`,
            capabilities: [{ key: "plan" as const }],
          },
        },
        { user },
      )
    ).data;
    await alepha.inject(ProjectCapabilityController).setCapability.fetch(
      {
        params: { projectId: project.id, key: "ship" },
        body: { enabled: true },
      },
      { user },
    );
    const copy = async (env: string) =>
      (
        await alepha
          .inject(AppController)
          .createApp.fetch(
            { params: { projectId: project.id }, body: { app: "my-app", env } },
            { user },
          )
      ).data;

    /**
     * A completed quest, with a recorded commit when `commit` is given.
     */
    const done = async (title: string, commit?: string) => {
      const quest = (
        await alepha.inject(QuestController).createQuest.fetch(
          {
            body: {
              projectId: project.id,
              title,
              description: "",
              area: "api",
              priority: "medium",
              objectives: [],
              attachments: [],
            },
          },
          { user },
        )
      ).data;
      await alepha.inject(Rows).quests.updateById(quest.id, {
        completedAt: "2026-11-01T00:00:00.000Z",
        ...(commit
          ? {
              commits: [
                { sha: commit, at: "2026-11-01T00:00:00.000Z", by: user.id },
              ],
            }
          : {}),
      } as never);
      return quest;
    };

    const ran = async (instanceId: string, commitSha?: string) =>
      await alepha.inject(Rows).deployments.create({
        projectId: project.id,
        instanceId,
        app: "my-app",
        tag: "latest",
        sha256: "e".repeat(64),
        status: "succeeded",
        finishedAt: "2026-11-02T00:00:00.000Z",
        ...(commitSha ? { commitSha } : {}),
      } as never);

    const list = async (query: Record<string, unknown>) =>
      (
        await alepha.inject(QuestController).getQuests.fetch(
          {
            params: { projectId: project.id },
            query: { status: "completed", ...query } as never,
          },
          { user },
        )
      ).data;

    return { user, project, copy, done, ran, list };
  };

  it("lists the copies running each quest, and the done ones no copy runs", async ({
    expect,
  }) => {
    const w = await world();
    const live = await w.done("Shipped", sha("1"));
    const waiting = await w.done("Merged, not deployed", sha("2"));
    await w.done("Closed with no commit");
    const production = await w.copy("production");
    await alepha.inject(CommitQuestSetService).record({
      projectId: w.project.id,
      commitSha: sha("a"),
      numbers: [live.shortId],
      walked: [],
      complete: true,
    });
    await w.ran(production.id, sha("a"));

    const withLive = await w.list({ withLive: true });
    const notLive = await w.list({ live: "not" });

    const liveOf = (shortId: number) =>
      withLive.content.find((quest) => quest.shortId === shortId)?.metadata
        .live;
    expect(liveOf(live.shortId)).toEqual([
      { app: "my-app", env: "production", dirty: false },
    ]);
    expect(liveOf(waiting.shortId)).toEqual([]);
    expect(notLive.content.map((quest) => quest.shortId)).toEqual([
      waiting.shortId,
    ]);
    expect(notLive.page.totalElements).toBe(1);
  });

  it("claims nothing as not live while a deployed copy's set is unknown", async ({
    expect,
  }) => {
    const w = await world();
    await w.done("Merged", sha("2"));
    const old = await w.copy("staging");
    // A deployment from before Lore recorded commits.
    await w.ran(old.id);

    const notLive = await w.list({ live: "not" });

    expect(notLive.content).toEqual([]);
  });

  it("carries the copies on quest_get, with since and dirty", async ({
    expect,
  }) => {
    const w = await world();
    const quest = await w.done("Shipped", sha("1"));
    const production = await w.copy("production");
    await alepha.inject(CommitQuestSetService).record({
      projectId: w.project.id,
      commitSha: sha("a"),
      numbers: [quest.shortId],
      walked: [],
      complete: true,
    });
    await w.ran(production.id, sha("a"));

    const got = await alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: w.user.id, roles: ["user"] });
      return (alepha.inject(QuestTools).quest_get as any).execute({
        id: quest.id,
      });
    });

    expect(got.live).toEqual([
      {
        app: "my-app",
        env: "production",
        dirty: false,
        since: "2026-11-02T00:00:00.000Z",
      },
    ]);
  });
});
