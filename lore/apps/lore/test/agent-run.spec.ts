import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AgentHostController,
  AgentHostService,
  HostCommandService,
  HostCommandTransport,
  HostJobService,
} from "@lore/core/api";
import { hostJobs, hosts, projects } from "@lore/core/schemas";
import { createTestHost } from "@lore/core/testing/hosts";
import { AgentRunController } from "@lore/plan/api";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import { TestEntityRepositories } from "./fixtures/entities.ts";

/**
 * Run a prompt on an Agent host from the CLI or MCP (#Q4225): `runAgent`,
 * `listProjectAgentHosts`, and `agent_run` called with a job's own key,
 * which the chain guard refuses (#Q4222).
 */
class ConnectedTransport extends HostCommandTransport {
  override async push(): Promise<boolean> {
    return true;
  }
}

class Repos {
  jobs = $repository(hostJobs);
  hosts = $repository(hosts);
  projects = $repository(projects);
}

const setup = async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "lore-agent-run-"));
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      DATA_DIR: dataDir,
    },
  });
  alepha.with({ provide: HostCommandTransport, use: ConnectedTransport });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaMcp);
  bootLore(alepha, ["api", "mcp"]);
  const entities = alepha.inject(TestEntityRepositories);
  const repos = alepha.inject(Repos);
  await alepha.start();
  const user = await entities.users.create({});
  const owner: UserAccountToken = { id: user.id, roles: ["user"] };
  const host = await createTestHost(alepha, owner, { slug: "agent-1" });
  await repos.hosts.updateById(host.id, {
    jobsAllowed: true,
    jobsTools: [
      { name: "claude", kind: "agent", found: true, version: "2.1.7" },
      { name: "git", kind: "tool", found: true, version: "2.43.0" },
    ],
  });
  await alepha
    .inject(AgentHostService)
    .setAgentHost(
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
    owner,
    projectId: host.projectId,
    baseUrl: alepha.inject(NodeHttpServerProvider).hostname,
    runs: alepha.inject(AgentRunController),
  };
};

type World = Awaited<ReturnType<typeof setup>>;

const mcp = async (w: World, token: string, name: string, args: object) => {
  const response = await fetch(`${w.baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  return (await response.json()) as {
    result?: { isError?: boolean; content?: Array<{ text?: string }> };
    error?: { message?: string };
  };
};

describe("lore agent run, and agent_run", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });
  afterEach(async () => {
    await w.alepha.stop();
    await rm(w.dataDir, { recursive: true, force: true });
  });

  it("reviews a pull request as a read job at its head, the author checked unless a member trusts it, and fixes on its branch (#Q4251)", async ({
    expect,
  }) => {
    await w.repos.projects.updateById(w.projectId, {
      repositoryUrl: "https://github.com/acme/web",
    });
    await w.repos.hosts.updateById((await w.repos.hosts.findMany({}))[0]!.id, {
      jobsSources: true,
    });
    const review = await w.runs.runAgent.run(
      {
        params: { projectId: w.projectId },
        body: { prompt: "review-pr", pr: 42 },
      },
      { user: w.owner },
    );
    const read = await w.repos.jobs.getOne({
      where: { id: { eq: review.jobId } },
    });
    expect(read.input).toMatchObject({
      workspace: "pr-42",
      source: {
        mode: "read",
        ref: "pull/42/head",
        trust: "pr-author-writes",
      },
    });
    expect(read.subjectType).toBe("pull-request");
    expect(read.input.prompt).toContain(
      "Review pull request #42 of the Lore project",
    );
    expect(read.input.prompt).toContain("https://github.com/acme/web/pull/42");
    expect(read.input.prompt).toContain("gh pr review 42");

    // A member's trust sends none: the host asks nothing of GitHub.
    const trusted = await w.runs.runAgent.run(
      {
        params: { projectId: w.projectId },
        body: { prompt: "review-pr", pr: 43, trust: true },
      },
      { user: w.owner },
    );
    const trustedJob = await w.repos.jobs.getOne({
      where: { id: { eq: trusted.jobId } },
    });
    expect(trustedJob.input.source).toEqual({
      mode: "read",
      ref: "pull/43/head",
    });

    // Review and fix: a write job whose branch Bay asks GitHub for.
    const fix = await w.runs.runAgent.run(
      {
        params: { projectId: w.projectId },
        body: { prompt: "review-pr", pr: 44, fix: true },
      },
      { user: w.owner },
    );
    const fixJob = await w.repos.jobs.getOne({
      where: { id: { eq: fix.jobId } },
    });
    expect(fixJob.input.source).toEqual({
      mode: "write",
      ref: "pull/44/head",
      trust: "pr-author-writes",
    });

    await expect(
      w.runs.runAgent.run(
        { params: { projectId: w.projectId }, body: { prompt: "review-pr" } },
        { user: w.owner },
      ),
    ).rejects.toThrow("A review-pr names its pull request");
  });

  it("runs a text prompt under Lore's preamble, in the workspace it names", async ({
    expect,
  }) => {
    const out = await w.runs.runAgent.run(
      {
        params: { projectId: w.projectId },
        body: {
          prompt: "text",
          text: "List the open quests of area web.",
          workspace: "notes",
          model: "sonnet",
        },
      },
      { user: w.owner },
    );
    const job = await w.repos.jobs.getOne({ where: { id: { eq: out.jobId } } });
    expect(job.input).toMatchObject({
      agent: "claude",
      model: "sonnet",
      workspace: "notes",
    });
    expect(job.input.prompt).toContain("## Where things are");
    expect(job.input.prompt).toContain("List the open quests of area web.");
    await expect(
      w.runs.runAgent.run(
        { params: { projectId: w.projectId }, body: { prompt: "build" } },
        { user: w.owner },
      ),
    ).rejects.toThrow("A build names its quest");
  });

  it("lists the project's Agent hosts with their agents and tools", async ({
    expect,
  }) => {
    const { items } = await w.alepha
      .inject(AgentHostController)
      .listProjectAgentHosts.run(
        { params: { projectId: w.projectId } },
        { user: w.owner },
      );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      slug: "agent-1",
      status: "available",
      agents: ["claude"],
    });
    expect(items[0]?.tools.map((tool) => tool.name)).toEqual(["claude", "git"]);
  });

  it("refuses agent_run called with a job's own key: a job never starts a job", async ({
    expect,
  }) => {
    const first = await w.runs.runAgent.run(
      {
        params: { projectId: w.projectId },
        body: { prompt: "text", text: "Read the inbox." },
      },
      { user: w.owner },
    );
    const row = await w.repos.jobs.getOne({
      where: { id: { eq: first.jobId } },
    });
    const spec = await w.alepha.inject(HostJobService).spec(row, w.baseUrl);
    const answer = await mcp(w, String(spec.key), "agent_run", {
      project: w.projectId,
      prompt: "text",
      text: "Start another job.",
    });
    const said = JSON.stringify(answer);
    expect(said).toContain("cannot start another agent job of its chain");
    expect(
      await w.repos.jobs.findMany({ where: { kind: { eq: "agent" } } }),
    ).toHaveLength(1);
  });
});
