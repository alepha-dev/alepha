import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentJobService, CodeRepositoryService } from "@lore/build/api";
import {
  AgentHostService,
  HostCommandService,
  HostCommandTransport,
  HostJobService,
} from "@lore/ship/api";
import { hostJobs, hosts } from "@lore/ship/schemas";
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
 * The agent job (#Q3986), Build's kind on Ship's queue: what it asks the
 * host for, what it keeps of Claude Code's result, and the guards around it.
 */
class ConnectedTransport extends HostCommandTransport {
  override async push(): Promise<boolean> {
    return true;
  }
}

class Repos {
  jobs = $repository(hostJobs);
  hosts = $repository(hosts);
}

const setup = async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "lore-agent-job-"));
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
  const hostRows = alepha.inject(HostJobService);
  await alepha
    .inject(CodeRepositoryService)
    .create({ projectId: host.projectId, slug: "acme" });
  return {
    alepha,
    dataDir,
    repos,
    agents,
    hostRows,
    service: alepha.inject(AgentJobService),
    commands: alepha.inject(HostCommandService),
    host,
    owner,
  };
};

type World = Awaited<ReturnType<typeof setup>>;

const makeAgentHost = async (w: World) => {
  await w.repos.hosts.updateById(w.host.id, { jobsAllowed: true });
  const row = await w.repos.hosts.getOne({ where: { id: { eq: w.host.id } } });
  await w.agents.setAgentHost(row, true);
  // The check the switch started, answered, so the agent job is next.
  const [check] = await w.repos.jobs.findMany({
    where: { kind: { eq: "check" } },
  });
  if (check?.commandId) {
    await w.commands.ack(w.host.id, { id: check.commandId, status: "done" });
  }
  await w.agents.setDefault(w.host.projectId, w.host.id);
};

const triage = (w: World, extra: Record<string, unknown> = {}) =>
  w.service.start({
    projectId: w.host.projectId,
    profile: "read",
    prompt: "Triage feedback 4.",
    tools: ["feedback_get", "feedback_comment_add"],
    feedbackNumber: 4,
    startedBy: w.owner.id,
    subjectType: "feedback",
    subjectId: "4",
    ...extra,
  });

describe("the agent job", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });
  afterEach(async () => {
    await w.alepha.stop();
    await rm(w.dataDir, { recursive: true, force: true });
  });

  it("refuses to start without a default Agent host", async ({ expect }) => {
    await expect(triage(w)).rejects.toThrow("names no Agent host");
  });

  it("asks for the read profile's budget and tools, and a key scoped to the feedback item", async ({
    expect,
  }) => {
    await makeAgentHost(w);
    const job = await triage(w);
    expect(job.kind).toBe("agent");
    expect(job.input).toMatchObject({
      profile: "read",
      maxTurns: 30,
      timeoutSeconds: 900,
      repository: {
        cloneUrl: expect.stringMatching(/\/acme\.git$/),
        ref: "main",
      },
      disallowedTools: ["Write", "Edit", "WebFetch", "WebSearch"],
      key: { tools: ["feedback_get", "feedback_comment_add"], feedbackId: 4 },
    });
    expect(job.input.allowedTools).toEqual(
      expect.arrayContaining([
        "Read",
        "Bash(git log:*)",
        "mcp__lore__feedback_get",
        "mcp__lore__feedback_comment_add",
      ]),
    );
    expect(job.input.key?.writeRefPrefix).toBeUndefined();

    const row = await w.repos.jobs.getOne({ where: { id: { eq: job.id } } });
    const spec = await w.hostRows.spec(row, "https://lore.test");
    expect(spec.repository).toMatchObject({
      cloneUrl: expect.stringMatching(/^https:\/\/lore\.test\/.*acme\.git$/),
    });
    expect(spec.egress).toEqual(
      expect.arrayContaining(["api.anthropic.com", "lore.test"]),
    );
    expect(String(spec.key)).toMatch(/^ak_lorejob_/);
  });

  it("gives a push job lore/q<n> to write and the registries to reach", async ({
    expect,
  }) => {
    await makeAgentHost(w);
    const job = await triage(w, {
      profile: "push",
      questNumber: 12,
      feedbackNumber: undefined,
      tools: ["quest_get"],
    });
    expect(job.input).toMatchObject({
      profile: "push",
      maxTurns: 100,
      permissionMode: "acceptEdits",
      key: { writeRefPrefix: "lore/q12", questId: 12 },
    });
    expect(job.input.egress).toEqual(
      expect.arrayContaining(["registry.npmjs.org", "github.com"]),
    );
  });

  it("keeps Claude Code's result, and pauses a job a usage limit stopped until its window", async ({
    expect,
  }) => {
    await makeAgentHost(w);
    const job = await triage(w);
    const row = await w.repos.jobs.getOne({ where: { id: { eq: job.id } } });
    const result = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: true,
      result: "Claude AI usage limit reached|1900000000",
      total_cost_usd: 0.42,
      num_turns: 3,
      usage: { input_tokens: 10 },
    });
    await w.hostRows.appendLog(
      await w.repos.hosts.getOne({ where: { id: { eq: w.host.id } } }),
      {
        type: "log",
        id: row.commandId as string,
        stream: "stdout",
        offset: 0,
        data: `${result}\n`,
      },
    );
    await w.commands.ack(w.host.id, {
      id: row.commandId as string,
      status: "failed",
      exitCode: 1,
    });
    const ended = await w.repos.jobs.getOne({ where: { id: { eq: job.id } } });
    expect(ended.status).toBe("paused");
    expect(ended.retryAt).toBe(new Date(1_900_000_000_000).toISOString());
    expect(ended.result).toMatchObject({
      isError: true,
      totalCostUsd: 0.42,
      numTurns: 3,
    });
  });

  it("never lets an agent's job start another agent job of its chain", async ({
    expect,
  }) => {
    await makeAgentHost(w);
    const first = await triage(w);
    await expect(triage(w, { startedByJobId: first.id })).rejects.toThrow(
      "cannot start another agent job of its chain",
    );
  });
});
