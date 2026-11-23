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
import { hostJobs, hosts } from "@lore/core/schemas";
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
