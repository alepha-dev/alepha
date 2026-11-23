import {
  HostCommandTransport,
  HostCommandService,
  HostJobService,
  AgentHostService,
} from "@lore/core/api";
import {
  projects,
  hostCommands,
  hostJobs,
  type Host,
  hosts,
} from "@lore/core/schemas";
import { createTestHost } from "@lore/core/testing/hosts";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { beforeEach, describe, it } from "vitest";

import { LoreShipApi } from "../src/api/index.ts";
import { DeployTestEntities } from "../src/testing/index.ts";

class ConnectedTransport extends HostCommandTransport {
  override async push(_host: Host, _frame: unknown): Promise<boolean> {
    return true;
  }
}

class Repos {
  hosts = $repository(hosts);
  jobs = $repository(hostJobs);
  commands = $repository(hostCommands);
  projects = $repository(projects);
}

const INIT = JSON.stringify({
  type: "system",
  subtype: "init",
  model: "claude-sonnet-4-5",
  apiKeySource: "none",
  claude_code_version: "2.0.14",
});

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  alepha.with({ provide: HostCommandTransport, use: ConnectedTransport });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreShipApi);
  const entities = alepha.inject(DeployTestEntities);
  const repos = alepha.inject(Repos);
  await alepha.start();
  const user = await entities.users.create({});
  const owner: UserAccountToken = { id: user.id, roles: ["user"] };
  const minted = await createTestHost(alepha, owner, { slug: "agent-1" });
  return {
    alepha,
    repos,
    agents: alepha.inject(AgentHostService),
    jobs: alepha.inject(HostJobService),
    commands: alepha.inject(HostCommandService),
    hostId: minted.id,
    projectId: minted.projectId,
  };
};

type World = Awaited<ReturnType<typeof setup>>;

const host = (w: World) =>
  w.repos.hosts.getOne({ where: { id: { eq: w.hostId } } });

/**
 * Ends the host's running check the way Bay would: its stdout, then its ack.
 */
const finishCheck = async (
  w: World,
  stdout: string,
  status: "done" | "failed",
) => {
  const [job] = await w.repos.jobs.findMany({
    where: { hostId: { eq: w.hostId }, kind: { eq: "check" } },
    orderBy: [{ column: "queuedAt", direction: "desc" }],
    limit: 1,
  });
  if (!job?.commandId) throw new Error("no running check");
  await w.jobs.appendLog(await host(w), {
    type: "log",
    id: job.commandId,
    stream: "stdout",
    offset: 0,
    data: stdout,
  });
  await w.commands.ack(w.hostId, { id: job.commandId, status });
};

describe("Agent hosts", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });

  it("needs jobs allowed before a host becomes an Agent host", async ({
    expect,
  }) => {
    await expect(w.agents.setAgentHost(await host(w), true)).rejects.toThrow(
      "allow jobs on it first",
    );
  });

  it("checks a new Agent host, and records the version, model and credential kind", async ({
    expect,
  }) => {
    await w.repos.hosts.updateById(w.hostId, { jobsAllowed: true });
    await w.agents.setAgentHost(await host(w), true);
    expect((await host(w)).agentStatus).toBe("checking");
    const result = JSON.stringify({
      type: "result",
      is_error: false,
      result: "OK",
      modelUsage: { "claude-sonnet-4-5-20250929": {} },
    });
    await finishCheck(w, `${INIT}\n${result}\n`, "done");
    const checked = await host(w);
    expect(checked.agentStatus).toBe("available");
    expect(checked.agentCliVersion).toBe("2.0.14");
    expect(checked.agentModel).toBe("claude-sonnet-4-5-20250929");
    expect(checked.agentCredential).toBe("oauth");
    expect(checked.agentError).toBeFalsy();
    expect(checked.agentCheckedAt).toBeDefined();
  });

  it("marks it unavailable with the CLI's message, and a passing check clears it", async ({
    expect,
  }) => {
    await w.repos.hosts.updateById(w.hostId, { jobsAllowed: true });
    await w.agents.setAgentHost(await host(w), true);
    const limit = JSON.stringify({
      type: "result",
      is_error: true,
      result: "Claude AI usage limit reached|1763700000",
    });
    await finishCheck(w, `${INIT}\n${limit}\n`, "failed");
    const failed = await host(w);
    expect(failed.agentStatus).toBe("unavailable");
    expect(failed.agentError).toContain("usage limit reached");

    await w.agents.recheck(w.hostId);
    const ok = JSON.stringify({
      type: "result",
      is_error: false,
      result: "OK",
    });
    await finishCheck(w, `${INIT}\n${ok}\n`, "done");
    const cleared = await host(w);
    expect(cleared.agentStatus).toBe("available");
    expect(cleared.agentError).toBeFalsy();
  });

  it("starts no second check while one is in flight", async ({ expect }) => {
    await w.repos.hosts.updateById(w.hostId, { jobsAllowed: true });
    await w.agents.setAgentHost(await host(w), true);
    expect(await w.agents.check(w.hostId)).toBeUndefined();
  });

  it("names the project's default Agent host, and forgets it when the host stops being one", async ({
    expect,
  }) => {
    await expect(w.agents.setDefault(w.projectId, w.hostId)).rejects.toThrow(
      "not an Agent host",
    );
    await w.repos.hosts.updateById(w.hostId, { jobsAllowed: true });
    await w.agents.setAgentHost(await host(w), true);
    await w.agents.setDefault(w.projectId, w.hostId);
    expect((await w.agents.defaultFor(w.projectId))?.id).toBe(w.hostId);

    await w.agents.setAgentHost(await host(w), false);
    expect(await w.agents.defaultFor(w.projectId)).toBeUndefined();
    const project = await w.repos.projects.getOne({
      where: { id: { eq: w.projectId } },
    });
    expect(project.defaultAgentHostId).toBeFalsy();
  });
});
