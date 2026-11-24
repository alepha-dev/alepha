import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AgentAutomationController,
  AgentAutomationService,
  AgentHostService,
  HostCommandService,
  HostCommandTransport,
} from "@lore/core/api";
import { agentAutomations, hostJobs, hosts } from "@lore/core/schemas";
import { createTestHost } from "@lore/core/testing/hosts";
import { feedback, quests } from "@lore/plan/schemas";
import { Alepha, AlephaError } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";

import { bootLore } from "./bootLore.ts";
import { TestEntityRepositories } from "./entities.ts";

/**
 * The world an agent automation spec runs in (#E172): Lore's api and mcp, a
 * project whose one Agent host reports `claude` and answered its check, and
 * helpers to file feedback and to end a job as its host would.
 */
class ConnectedTransport extends HostCommandTransport {
  override async push(): Promise<boolean> {
    return true;
  }
}

export class AutomationRepos {
  jobs = $repository(hostJobs);
  hosts = $repository(hosts);
  automations = $repository(agentAutomations);
  feedback = $repository(feedback);
  quests = $repository(quests);
}

export const automationWorld = async (env: Record<string, unknown> = {}) => {
  const dataDir = await mkdtemp(join(tmpdir(), "lore-automations-"));
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      DATA_DIR: dataDir,
      ...env,
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
  const repos = alepha.inject(AutomationRepos);
  await alepha.start();
  const user = await entities.users.create({});
  const owner: UserAccountToken = { id: user.id, roles: ["user"] };
  const host = await createTestHost(alepha, owner, { slug: "agent-1" });
  await repos.hosts.updateById(host.id, {
    jobsAllowed: true,
    jobsTools: [{ name: "claude", kind: "agent", found: true, version: "2" }],
  });
  await alepha
    .inject(AgentHostService)
    .setAgentHost(
      await repos.hosts.getOne({ where: { id: { eq: host.id } } }),
      true,
    );
  const commands = alepha.inject(HostCommandService);
  const [check] = await repos.jobs.findMany({
    where: { kind: { eq: "check" } },
  });
  if (check?.commandId) {
    await commands.ack(host.id, { id: check.commandId, status: "done" });
  }
  let shortIds = 0;
  return {
    alepha,
    dataDir,
    entities,
    repos,
    owner,
    hostId: host.id,
    projectId: host.projectId,
    service: alepha.inject(AgentAutomationService),
    controller: alepha.inject(AgentAutomationController),
    /**
     * A pending feedback item a member wrote, which an agent may read.
     */
    file: (title = "The save button fails") =>
      repos.feedback.create({
        projectId: host.projectId,
        shortId: ++shortIds,
        title,
        description: `${title}: nothing happens on click.`,
        status: "pending",
        untrusted: false,
      }),
    /**
     * Ends a job as its host would: the running job's command acknowledged.
     * A queued job is dispatched first.
     */
    finish: async (jobId: string, status: "done" | "failed" = "done") => {
      const job = await repos.jobs.getOne({ where: { id: { eq: jobId } } });
      if (!job.commandId) {
        throw new AlephaError(`Job ${jobId} was never dispatched`);
      }
      await commands.ack(job.hostId, { id: job.commandId, status: "running" });
      await commands.ack(job.hostId, { id: job.commandId, status });
    },
    stop: async () => {
      await alepha.stop();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
};

export type AutomationWorld = Awaited<ReturnType<typeof automationWorld>>;
