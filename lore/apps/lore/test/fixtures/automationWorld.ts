import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AgentAutomationController,
  AgentAutomationService,
  AgentHostService,
  AgentAutomationTriggers,
  HostCommandService,
  HostCommandTransport,
  HostJobService,
} from "@lore/core/api";
import { projectEvents } from "@lore/core/api";
import { agentAutomations, hostJobs, hosts } from "@lore/core/schemas";
import { createTestHost } from "@lore/core/testing/hosts";
import { FeedbackController } from "@lore/plan/api";
import { feedback, quests } from "@lore/plan/schemas";
import { Alepha, AlephaError } from "alepha";
import {
  JobProvider,
  JobQueueProvider,
  jobExecutionEntity,
} from "alepha/api/jobs";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";

import { bootLore } from "./bootLore.ts";
import { TestEntityRepositories } from "./entities.ts";
import { ManualCronProvider } from "./ManualCronProvider.ts";

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

/**
 * Holds every dispatch: a spec runs the jobs itself, with `drain`, so what
 * ran is decided by the spec and not by the machine's load.
 */
class HeldQueue extends JobQueueProvider {
  public override async dispatch(_name: string, _id: string) {}
}

export class AutomationRepos {
  executions = $repository(jobExecutionEntity);
  jobs = $repository(hostJobs);
  hosts = $repository(hosts);
  automations = $repository(agentAutomations);
  events = $repository(projectEvents);
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
  alepha.with({ provide: CronProvider, use: ManualCronProvider });
  alepha.with({ provide: JobQueueProvider, use: HeldQueue });
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
  const baseUrl = alepha.inject(NodeHttpServerProvider).hostname;
  return {
    alepha,
    dataDir,
    entities,
    repos,
    owner,
    hostId: host.id,
    projectId: host.projectId,
    baseUrl,
    service: alepha.inject(AgentAutomationService),
    triggers: alepha.inject(AgentAutomationTriggers),
    controller: alepha.inject(AgentAutomationController),
    /**
     * Feedback submitted through the inbox's own action, as the owner: its
     * `feedback.created` event recorded with it.
     */
    submit: async (title = "The save button fails") =>
      (
        await alepha.inject(FeedbackController).submitFeedback.fetch(
          {
            params: { projectId: host.projectId },
            body: { title, description: `${title}: nothing happens.` },
          },
          { user: owner },
        )
      ).data,
    /**
     * A job's key, minted as its host would pull its spec.
     */
    keyOf: async (jobId: string) => {
      const row = await repos.jobs.getOne({ where: { id: { eq: jobId } } });
      const spec = await alepha.inject(HostJobService).spec(row, baseUrl);
      return String(spec.key);
    },
    /**
     * One MCP tool call with a bearer token.
     */
    mcp: async (token: string, name: string, args: object) => {
      const response = await fetch(`${baseUrl}/mcp`, {
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
    },
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
    /**
     * Runs every held job of these names that is due: the event deliveries
     * and the automations' settle jobs, until none is left.
     */
    drain: async (
      names: string[] = ["project-events.deliver", "agent-automations.settle"],
    ) => {
      const jobs = alepha.inject(JobProvider);
      const now = alepha.inject(DateTimeProvider).nowISOString();
      for (let pass = 0; pass < 10; pass++) {
        const due = (
          await repos.executions.findMany({
            where: {
              jobName: { inArray: names },
              status: { inArray: ["pending", "scheduled"] },
            },
          })
        ).filter((row) => !row.scheduledAt || row.scheduledAt <= now);
        if (!due.length) return;
        for (const row of due) {
          if (row.status === "scheduled") {
            await repos.executions.updateById(row.id, { status: "pending" });
          }
          await jobs.processExecution(row.jobName, row.id);
        }
      }
    },
    /**
     * The settle jobs still waiting for their time.
     */
    waiting: async () =>
      repos.executions.findMany({
        where: {
          jobName: { eq: "agent-automations.settle" },
          status: { eq: "scheduled" },
        },
      }),
    stop: async () => {
      await alepha.stop();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
};

export type AutomationWorld = Awaited<ReturnType<typeof automationWorld>>;
