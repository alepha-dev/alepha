import type { HostJobSummary } from "@lore/core/api";
import { comments, hostJobs, hosts, jobKeys } from "@lore/core/schemas";
import { createTestProject } from "@lore/core/testing";
import { QuestTools } from "@lore/plan/mcp";
import { quests } from "@lore/plan/schemas";
import { createTestQuest } from "@lore/plan/testing";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import { TestEntityRepositories } from "./fixtures/entities.ts";

class Repos {
  keys = $repository(jobKeys);
  hosts = $repository(hosts);
  jobs = $repository(hostJobs);
  quests = $repository(quests);
  comments = $repository(comments);
}

/**
 * A quest knows the agent job working it (#Q4350): a job's key stamps the
 * quest it accepts, unassign and complete clear it, a member's accept
 * stamps nothing, and the job's end hands every quest it still holds back
 * to To do, with a history line naming the job.
 */
describe("a quest and the agent job working it", () => {
  let alepha: Alepha;
  let repos: Repos;
  let tools: QuestTools;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let ownerId: string;
  let apiKeyId: string;
  let jobId: string;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaMcp);
    bootLore(alepha, ["api", "mcp"]);
    repos = alepha.inject(Repos);
    alepha.inject(TestEntityRepositories);
    tools = alepha.inject(QuestTools);
    await alepha.start();
    project = await createTestProject(alepha, { title: "Acme" });
    ownerId = project.createdBy!;
    apiKeyId = crypto.randomUUID();
    jobId = crypto.randomUUID();
    await repos.keys.create({
      apiKeyId,
      jobId,
      projectId: project.id,
      userId: ownerId,
      expiresAt: new Date(
        alepha.inject(DateTimeProvider).nowMillis() + 60_000,
      ).toISOString(),
    });
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const as = <R>(job: boolean, fn: () => Promise<R>): Promise<R> =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: ownerId, roles: ["user"] });
      alepha.store.set("alepha.http.request", {
        user: {
          id: ownerId,
          roles: ["user"],
          ...(job ? { credential: { type: "api-key", id: apiKeyId } } : {}),
        },
      } as never);
      return fn();
    });
  const accept = (shortId: number, job = true) =>
    as(job, () => tools.quest_accept.execute({ project: project.id, shortId }));
  const row = (id: number) =>
    repos.quests.getOne({ where: { id: { eq: id } } });
  const ended = (status: HostJobSummary["status"]) =>
    alepha.events.emit("host:job:ended", {
      job: {
        id: jobId,
        projectId: project.id,
        kind: "agent",
        status,
        startedBy: ownerId,
        queuedAt: new Date().toISOString(),
        prompt: "work-loose-quests",
        input: { timeoutSeconds: 600 },
      } as HostJobSummary,
    });

  it("stamps the quest a job's key accepts, shows it on quest_get and quest_list, and a member's accept stamps nothing", async ({
    expect,
  }) => {
    const byJob = await createTestQuest(alepha, project);
    const byHand = await createTestQuest(alepha, project);
    await accept(byJob.shortId);
    await accept(byHand.shortId, false);
    expect((await row(byJob.id)).agentJobId).toBe(jobId);
    expect((await row(byHand.id)).agentJobId).toBeUndefined();

    const got = (await as(false, () =>
      tools.quest_get.execute({ project: project.id, shortId: byJob.shortId }),
    )) as { agentJobId?: string };
    expect(got.agentJobId).toBe(jobId);
    const list = (await as(false, () =>
      tools.quest_list.execute({ project: project.id }),
    )) as { quests: Array<{ shortId: number; agentJobId?: string }> };
    expect(
      list.quests.find((it) => it.shortId === byJob.shortId)?.agentJobId,
    ).toBe(jobId);
    expect(
      list.quests.find((it) => it.shortId === byHand.shortId)?.agentJobId,
    ).toBeUndefined();
  });

  it("copies the job's agent CLI with the stamp, shows it beside agentJobId, and clears both together (#Q4353)", async ({
    expect,
  }) => {
    const host = await repos.hosts.create({
      projectId: project.id,
      ownerUserId: ownerId,
      type: "bay",
      slug: "nfo1",
    });
    await repos.jobs.create({
      id: jobId,
      projectId: project.id,
      hostId: host.id,
      kind: "agent",
      status: "running",
      input: { agent: "claude", timeoutSeconds: 600 },
      queuedAt: new Date().toISOString(),
    });
    const quest = await createTestQuest(alepha, project);
    await accept(quest.shortId);
    expect(await row(quest.id)).toMatchObject({
      agentJobId: jobId,
      agentName: "claude",
    });
    const got = (await as(false, () =>
      tools.quest_get.execute({ project: project.id, shortId: quest.shortId }),
    )) as { agentName?: string };
    expect(got.agentName).toBe("claude");
    const list = (await as(false, () =>
      tools.quest_list.execute({ project: project.id }),
    )) as { quests: Array<{ shortId: number; agentName?: string }> };
    expect(
      list.quests.find((it) => it.shortId === quest.shortId)?.agentName,
    ).toBe("claude");

    await as(false, () =>
      tools.quest_unassign.execute({
        project: project.id,
        shortId: quest.shortId,
      }),
    );
    const after = await row(quest.id);
    expect(after.agentJobId).toBeUndefined();
    expect(after.agentName).toBeUndefined();
  });

  it("clears the stamp on unassign and on complete", async ({ expect }) => {
    const unassigned = await createTestQuest(alepha, project);
    const completed = await createTestQuest(alepha, project);
    await accept(unassigned.shortId);
    await accept(completed.shortId);
    await as(false, () =>
      tools.quest_unassign.execute({
        project: project.id,
        shortId: unassigned.shortId,
      }),
    );
    await as(true, () =>
      tools.quest_complete.execute({
        project: project.id,
        shortId: completed.shortId,
      }),
    );
    expect((await row(unassigned.id)).agentJobId).toBeUndefined();
    expect((await row(completed.id)).agentJobId).toBeUndefined();
  });

  it("hands every quest the job still holds back to To do when it ends, and leaves a member's alone", async ({
    expect,
  }) => {
    const held = await createTestQuest(alepha, project);
    const mine = await createTestQuest(alepha, project);
    await accept(held.shortId);
    await accept(mine.shortId, false);
    await ended("succeeded");

    const back = await row(held.id);
    expect(back.acceptedAt).toBeUndefined();
    expect(back.acceptedBy).toBeUndefined();
    expect(back.agentJobId).toBeUndefined();
    expect(back.history.at(-1)).toMatchObject({
      action: "unassigned",
      by: ownerId,
      jobId,
    });
    // A job that ended done says nothing: the quest is just free again.
    expect(
      await repos.comments.findMany({
        where: { subjectType: { eq: "quest" }, subjectId: { eq: held.id } },
      }),
    ).toEqual([]);
    expect((await row(mine.id)).acceptedBy).toBe(ownerId);
  });

  for (const status of ["failed", "timed_out", "cancelled"] as const) {
    it(`hands back on ${status} too, with a comment saying the quest is in To do`, async ({
      expect,
    }) => {
      const held = await createTestQuest(alepha, project);
      await accept(held.shortId);
      await ended(status);
      expect((await row(held.id)).acceptedAt).toBeUndefined();
      const [comment] = await repos.comments.findMany({
        where: { subjectType: { eq: "quest" }, subjectId: { eq: held.id } },
      });
      expect(comment?.body).toContain("The quest is back in To do");
    });
  }
});
