import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HostCommandTransport, HostCommandService } from "@lore/core/api";
import { projectCapabilities, hostJobs, hosts } from "@lore/core/schemas";
import { createTestHost } from "@lore/core/testing/hosts";
import { QuestAgentService, QuestService } from "@lore/plan/api";
import { quests } from "@lore/plan/schemas";
import { AgentHostService, PromptRunService } from "@lore/prompts/api";
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
 * Quest work (#Q3989): an accepted quest worked by an agent job whose key is
 * pinned to it, and an untrusted quest held until a member confirms.
 */
class ConnectedTransport extends HostCommandTransport {
  override async push(): Promise<boolean> {
    return true;
  }
}

class Repos {
  jobs = $repository(hostJobs);
  hosts = $repository(hosts);
  quests = $repository(quests);
  capabilities = $repository(projectCapabilities);
}

const setup = async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "lore-quest-agent-"));
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
  return {
    alepha,
    dataDir,
    repos,
    agentWork: alepha.inject(QuestAgentService),
    questService: alepha.inject(QuestService),
    projectId: host.projectId,
    hostId: host.id,
    owner,
  };
};

type World = Awaited<ReturnType<typeof setup>>;

const aQuest = async (w: World, patch: Record<string, unknown> = {}) => {
  const quest = await w.questService.createQuest({
    projectId: w.projectId,
    title: "Fix the save button",
    description: "It does nothing.",
    area: "web",
    createdBy: w.owner.id,
  } as never);
  await w.repos.quests.updateById(quest.id, {
    acceptedAt: new Date().toISOString(),
    ...patch,
  });
  return w.repos.quests.getOne({ where: { id: { eq: quest.id } } });
};

/**
 * The quest's work, run as the `work-quest` prompt (#Q4275).
 */
const work = (w: World, shortId: number) =>
  w.alepha.inject(PromptRunService).run(w.projectId, w.owner, "work-quest", {
    args: { quest: String(shortId) },
  });

describe("a quest worked by an agent job", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });
  afterEach(async () => {
    await w.alepha.stop();
    await rm(w.dataDir, { recursive: true, force: true });
  });

  it("works the quest in its own workspace, its key pinned to the quest", async ({
    expect,
  }) => {
    const quest = await aQuest(w);
    const { jobId } = await work(w, quest.shortId);
    const job = await w.repos.jobs.getOne({ where: { id: { eq: jobId } } });
    // Its own workspace on the host, removed when the quest completes.
    expect(job.input.workspace).toBe(`q${quest.shortId}`);
    expect(job.input.key).toEqual({ questId: quest.shortId });
    // Build on a light host (#Q4224): branch, checks, a commit naming the
    // quest, a pull request with gh recorded on the quest.
    expect(job.input.prompt).toContain("## Where things are");
    // No repository on this project: no worktree, and nothing tells the
    // agent to clone or branch (#E173).
    expect(job.input.source).toEqual({ mode: "none" });
    expect(job.input.prompt).toContain("open a pull request into main");
    expect(job.input.prompt).toContain("quest_pull_request_add");
    expect(job.input.prompt).toContain(`its message naming #Q`);
    expect(job.input.prompt).not.toContain("lore/q");
    expect(job.input.prompt).toContain("Work on quest #Q");
  });

  it("refuses a completed quest: the prompt's arg accepts a quest to do or in progress", async ({
    expect,
  }) => {
    const done = await aQuest(w, { completedAt: new Date().toISOString() });
    await expect(work(w, done.shortId)).rejects.toThrow("accepts a quest");
  });

  it("holds an untrusted quest until a member confirms its text, recorded with who and when", async ({
    expect,
  }) => {
    const quest = await aQuest(w, { untrusted: true });
    await expect(work(w, quest.shortId)).rejects.toThrow(
      "a member confirms its text",
    );
    const confirmed = await w.agentWork.confirm(
      w.projectId,
      quest.shortId,
      w.owner.id,
    );
    expect(confirmed.untrustedConfirmedBy).toBe(w.owner.id);
    expect(confirmed.untrustedConfirmedAt).toBeDefined();
    const { jobId } = await work(w, quest.shortId);
    expect(jobId).toBeDefined();
  });
});
