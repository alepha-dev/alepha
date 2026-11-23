import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CodeRepositoryService } from "@lore/build/api";
import {
  HostCommandTransport,
  HostCommandService,
  AgentHostService,
} from "@lore/core/api";
import {
  projectCapabilities,
  projectPrompts,
  hostJobs,
  hosts,
} from "@lore/core/schemas";
import { QuestAgentService, QuestService } from "@lore/plan/api";
import { quests } from "@lore/plan/schemas";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { createTestHost } from "../../../packages/@lore/ship/src/testing/hosts.ts";
import { bootLore } from "./fixtures/bootLore.ts";
import { TestEntityRepositories } from "./fixtures/entities.ts";

/**
 * Quest to branch (#Q3989): an accepted quest worked by a push job whose key
 * writes lore/q<n> only, and an untrusted quest held until a member confirms.
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
  prompts = $repository(projectPrompts);
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
  await alepha
    .inject(CodeRepositoryService)
    .create({ projectId: host.projectId, slug: "acme" });
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
  await agents.setDefault(host.projectId, host.id);
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

describe("a quest worked by an agent job", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });
  afterEach(async () => {
    await w.alepha.stop();
    await rm(w.dataDir, { recursive: true, force: true });
  });

  it("pushes lore/q<n> only, reaches this quest's four tools and no quest_complete", async ({
    expect,
  }) => {
    const quest = await aQuest(w);
    const { jobId } = await w.agentWork.work(
      w.projectId,
      quest.shortId,
      w.owner.id,
    );
    const job = await w.repos.jobs.getOne({ where: { id: { eq: jobId } } });
    expect(job.input.profile).toBe("push");
    expect(job.input.key).toMatchObject({
      writeRefPrefix: `lore/q${quest.shortId}`,
      questId: quest.shortId,
      tools: [
        "quest_get",
        "quest_objective_set",
        "quest_comment_add",
        "quest_commit_add",
      ],
    });
    expect(job.input.key?.tools).not.toContain("quest_complete");
    expect(job.input.prompt).toContain(`lore/q${quest.shortId}`);
    expect(job.input.prompt).toContain("do not complete the quest");
    expect(job.input.prompt).toContain("Work on quest #Q");
  });

  it("refuses a quest nobody accepted, or one already completed", async ({
    expect,
  }) => {
    const open = await aQuest(w, { acceptedAt: null });
    await expect(
      w.agentWork.work(w.projectId, open.shortId, w.owner.id),
    ).rejects.toThrow("not accepted and open");
    const done = await aQuest(w, { completedAt: new Date().toISOString() });
    await expect(
      w.agentWork.work(w.projectId, done.shortId, w.owner.id),
    ).rejects.toThrow("not accepted and open");
  });

  it("holds an untrusted quest until a member confirms its text, recorded with who and when", async ({
    expect,
  }) => {
    const quest = await aQuest(w, { untrusted: true });
    await expect(
      w.agentWork.work(w.projectId, quest.shortId, w.owner.id),
    ).rejects.toThrow("a member confirms its text");
    const confirmed = await w.agentWork.confirm(
      w.projectId,
      quest.shortId,
      w.owner.id,
    );
    expect(confirmed.untrustedConfirmedBy).toBe(w.owner.id);
    expect(confirmed.untrustedConfirmedAt).toBeDefined();
    const { jobId } = await w.agentWork.work(
      w.projectId,
      quest.shortId,
      w.owner.id,
    );
    expect(jobId).toBeDefined();
  });
});
