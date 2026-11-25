import {
  HostCommandTransport,
  HostCommandService,
  HostJobService,
} from "@lore/core/api";
import {
  projects,
  hostCommands,
  hostJobs,
  type Host,
  hosts,
} from "@lore/core/schemas";
import { createTestHost } from "@lore/core/testing/hosts";
import { AgentHostService, LorePromptsApi } from "@lore/prompts/api";
import { LoreShipApi } from "@lore/ship/api";
import { DeployTestEntities } from "@lore/ship/testing";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { beforeEach, describe, it } from "vitest";

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
  alepha.with(LorePromptsApi);
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
  output: string,
  status: "done" | "failed",
  stream: "stdout" | "stderr" = "stdout",
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
    stream,
    offset: 0,
    data: output,
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

  it("checks a new Agent host, and passes it on exit 0 whatever the agent printed (#Q4222)", async ({
    expect,
  }) => {
    await w.repos.hosts.updateById(w.hostId, { jobsAllowed: true });
    await w.agents.setAgentHost(await host(w), true);
    expect((await host(w)).agentStatus).toBe("checking");
    const [check] = await w.repos.jobs.findMany({
      where: { kind: { eq: "check" } },
    });
    // No Claude vocabulary in the check: Bay's adapter asks its question.
    expect(check?.input).toEqual({ timeoutSeconds: 120 });
    await finishCheck(w, "not JSON at all\n", "done");
    const checked = await host(w);
    expect(checked.agentStatus).toBe("available");
    expect(checked.agentError).toBeFalsy();
    expect(checked.agentCheckedAt).toBeDefined();
    expect(checked).not.toHaveProperty("agentCliVersion");
  });

  it("marks it unavailable with the tail of the agent's stderr, and a passing check clears it", async ({
    expect,
  }) => {
    await w.repos.hosts.updateById(w.hostId, { jobsAllowed: true });
    await w.agents.setAgentHost(await host(w), true);
    await finishCheck(
      w,
      "bay: 12:00:00.000 agent claude started\nInvalid API key · Please run /login\n",
      "failed",
      "stderr",
    );
    const failed = await host(w);
    expect(failed.agentStatus).toBe("unavailable");
    expect(failed.agentError).toBe("Invalid API key · Please run /login");

    await w.agents.check(w.hostId);
    await finishCheck(w, "OK\n", "done");
    const cleared = await host(w);
    expect(cleared.agentStatus).toBe("available");
    expect(cleared.agentError).toBeFalsy();
  });

  it("starts no second check while one is in flight", async ({ expect }) => {
    await w.repos.hosts.updateById(w.hostId, { jobsAllowed: true });
    await w.agents.setAgentHost(await host(w), true);
    expect(await w.agents.check(w.hostId)).toBeUndefined();
  });

  it("lists the project's Agent hosts, and none once the host stops being one (#Q4223)", async ({
    expect,
  }) => {
    expect(await w.agents.list(w.projectId)).toEqual([]);
    await w.repos.hosts.updateById(w.hostId, { jobsAllowed: true });
    await w.agents.setAgentHost(await host(w), true);
    expect((await w.agents.list(w.projectId)).map((it) => it.id)).toEqual([
      w.hostId,
    ]);
    await w.agents.setAgentHost(await host(w), false);
    expect(await w.agents.list(w.projectId)).toEqual([]);
  });
});
