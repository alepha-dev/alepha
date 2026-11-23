import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AgentHostService,
  HostCommandService,
  HostCommandTransport,
  JobKeyService,
} from "@lore/core/api";
import { hostJobs, hosts, type JobKey } from "@lore/core/schemas";
import { createTestHost } from "@lore/core/testing/hosts";
import { EpicAgentService } from "@lore/plan/api";
import { epics, quests } from "@lore/plan/schemas";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import { TestEntityRepositories } from "./fixtures/entities.ts";

/**
 * Review with an agent (#Q4214): an epic's Review prompt run as an agent job,
 * its key pinned to the epic, refused for a started epic, a second run, or
 * an unconfirmed untrusted quest on a process host.
 */
class ConnectedTransport extends HostCommandTransport {
  override async push(): Promise<boolean> {
    return true;
  }
}

class Repos {
  jobs = $repository(hostJobs);
  hosts = $repository(hosts);
  epics = $repository(epics);
  quests = $repository(quests);
}

const setup = async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "lore-epic-agent-"));
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:", DATA_DIR: dataDir },
  });
  alepha.with({ provide: HostCommandTransport, use: ConnectedTransport });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  bootLore(alepha);
  const entities = alepha.inject(TestEntityRepositories);
  const repos = alepha.inject(Repos);
  await alepha.start();
  const user = await entities.users.create({});
  const owner: UserAccountToken = { id: user.id, roles: ["user"] };
  const host = await createTestHost(alepha, owner, { slug: "agent-1" });
  const agents = alepha.inject(AgentHostService);
  await repos.hosts.updateById(host.id, {
    jobsAllowed: true,
    jobsRunner: "process",
  });
  await agents.setAgentHost(
    await repos.hosts.getOne({ where: { id: { eq: host.id } } }),
    true,
  );
  const [check] = await repos.jobs.findMany({
    where: { kind: { eq: "check" } },
  });
  if (check?.commandId) {
    await alepha
      .inject(HostCommandService)
      .ack(host.id, { id: check.commandId, status: "done" });
  }
  const epic = await repos.epics.create({
    projectId: host.projectId,
    number: 3,
    title: "Search",
    status: "ready",
  });
  const other = await repos.epics.create({
    projectId: host.projectId,
    number: 4,
    title: "Other",
    status: "draft",
  });
  const quest = (shortId: number, epicId: number, extra = {}) =>
    repos.quests.create({
      projectId: host.projectId,
      shortId,
      title: `Quest ${shortId}`,
      description: "Do the work.",
      area: "web",
      priority: "medium",
      createdBy: owner.id,
      epicId,
      ...extra,
      // The row's defaults (history, objectives) are the repository's.
    } as never);
  await quest(10, epic.id);
  await quest(11, epic.id);
  await quest(20, other.id);
  return {
    alepha,
    dataDir,
    repos,
    quest,
    epic,
    service: alepha.inject(EpicAgentService),
    keys: alepha.inject(JobKeyService),
    projectId: host.projectId,
    hostId: host.id,
    owner,
  };
};

type World = Awaited<ReturnType<typeof setup>>;

describe("an epic reviewed by an agent job", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });
  afterEach(async () => {
    await w.alepha.stop();
    await rm(w.dataDir, { recursive: true, force: true });
  });

  it("runs the Review prompt under the job's rules, its key pinned to the epic", async ({
    expect,
  }) => {
    const out = await w.service.review(w.projectId, 3, w.owner.id);
    const job = await w.repos.jobs.getOne({ where: { id: { eq: out.jobId } } });
    expect(job.subjectType).toBe("epic");
    expect(job.subjectId).toBe("3");
    expect(job.input.key).toEqual({ epicId: 3 });
    expect(job.input.prompt).toContain("Nobody reads this run's chat");
    expect(job.input.prompt).toContain('Review the plan of epic #E3 "Search"');
    // A quarter of an hour, plus 90 s for each of the epic's 2 quests.
    expect(job.input.timeoutSeconds).toBe(15 * 60 + 2 * 90);
    const row = await w.repos.epics.getOne({
      where: { id: { eq: w.epic.id } },
    });
    expect(row.agentReviewJobId).toBe(out.jobId);
  });

  it("refuses a started epic, and a second run while one is queued", async ({
    expect,
  }) => {
    await w.service.review(w.projectId, 3, w.owner.id);
    await expect(w.service.review(w.projectId, 3, w.owner.id)).rejects.toThrow(
      /already (queued|running)/,
    );
    await w.repos.epics.updateById(w.epic.id, { status: "in_progress" });
    await expect(w.service.review(w.projectId, 3, w.owner.id)).rejects.toThrow(
      "only a draft or ready epic",
    );
  });

  it("refuses an epic holding an unconfirmed untrusted quest on any host, and runs once it is confirmed", async ({
    expect,
  }) => {
    const quest = await w.quest(12, w.epic.id, { untrusted: true });
    await expect(w.service.review(w.projectId, 3, w.owner.id)).rejects.toThrow(
      /#Q12.*a member confirms their text first/,
    );
    await w.repos.quests.updateById(quest.id, {
      untrustedConfirmedAt: new Date().toISOString(),
      untrustedConfirmedBy: w.owner.id,
    });
    const out = await w.service.review(w.projectId, 3, w.owner.id);
    expect(out.jobId).toBeDefined();
  });

  it("holds the key's quest tools to the epic's own quests", async ({
    expect,
  }) => {
    const key = {
      projectId: w.projectId,
      epicNumber: 3,
    } as JobKey;
    await expect(
      w.keys.checkEpicQuest(key, "quest_update", { shortId: 10 }),
    ).resolves.toBeUndefined();
    await expect(
      w.keys.checkEpicQuest(key, "quest_get", { shortId: 20 }),
    ).rejects.toThrow("the quests of epic 3 only");
    // A quest the review just filed under the epic passes.
    await w.quest(13, w.epic.id);
    await expect(
      w.keys.checkEpicQuest(key, "quest_objective_set", { shortId: 13 }),
    ).resolves.toBeUndefined();
    await expect(w.keys.checkEpicQuest(key, "quest_get", {})).rejects.toThrow(
      "the quests of epic 3 only",
    );
  });
});
