import { HostJobService, HostJobs } from "@lore/core/api";
import {
  type Host,
  type HostJobTool,
  hostJobs,
  hostProjects,
  hosts,
} from "@lore/core/schemas";
import { $hook, $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";

/**
 * Agent hosts (#Q3985): hosts that run agent CLI jobs, and Lore's check that
 * they still can.
 *
 * Hosts stay what they are (review answer 1): one boolean, `agentHost`, on
 * a host that already runs jobs (`jobsAllowed`). Its operator installs an
 * agent CLI and signs it in by hand for Bay's jobs user; Lore never
 * configures it and never sees the credential. What Lore does is ask: a
 * **check job**, the agent's version then a one-line prompt with nothing in
 * reach. It passes on exit 0 (#Q4222: Lore reads nothing of its output); a
 * failure keeps the tail of what it printed on stderr as the host's error.
 *
 * A check runs when a host becomes an Agent host, once a day, and on
 * demand. A failing check marks the host `unavailable` with the message;
 * the next passing one clears it.
 *
 * A project runs its agent jobs on any of its Agent hosts, its own or lent
 * ones (#Q4223): a run names its host when there are several, its agent
 * when the host reports several.
 */
export class AgentHostService {
  /**
   * The agent CLIs a host reports as answering (#Q4220): found, and its
   * version command did not fail.
   */
  public static agentsOf(tools: HostJobTool[] | undefined | null): string[] {
    return (tools ?? [])
      .filter((tool) => tool.kind === "agent" && tool.found && !tool.error)
      .map((tool) => tool.name);
  }

  /**
   * A check's time: two minutes for a cold CLI.
   */
  public static readonly CHECK_TIMEOUT_SECONDS = 120;

  protected readonly log = $logger();
  protected readonly hosts = $repository(hosts);
  protected readonly loans = $repository(hostProjects);
  protected readonly jobRows = $repository(hostJobs);
  protected readonly jobs = $inject(HostJobService);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly port = $inject(HostJobs);

  constructor() {
    // `HostController` sets the role through the port (#E175).
    this.port.registerAgentHostRole({
      set: (host, on, userId) => this.setAgentHost(host, on, userId),
    });
    // The agent kind finds its host through the port.
    this.port.registerAgentHosts({
      list: async (projectId) =>
        (await this.list(projectId)).map((host) => ({
          id: host.id,
          slug: host.slug,
          ...(host.agentStatus ? { status: host.agentStatus } : {}),
          ...(host.offlineSince ? { offline: true } : {}),
          ...(host.jobsTools
            ? { agents: AgentHostService.agentsOf(host.jobsTools) }
            : {}),
          ...(host.jobsSources ? { sources: true } : {}),
          ...(host.jobsUser ? { jobsUser: host.jobsUser } : {}),
          ...(host.jobsTools?.some(
            (tool) => tool.name === "gh" && tool.signedIn === false,
          )
            ? { ghSignedOut: true }
            : {}),
        })),
    });
  }

  /**
   * Makes a host an Agent host or not. On, it needs `jobsAllowed` and a
   * check starts at once.
   */
  public async setAgentHost(
    host: Host,
    on: boolean,
    userId?: string,
  ): Promise<void> {
    if (on && !host.jobsAllowed) {
      throw new BadRequestError(
        `Host "${host.slug}" does not run jobs: allow jobs on it first`,
      );
    }
    await this.hosts.updateById(host.id, {
      agentHost: on,
      ...(on ? {} : { agentStatus: null }),
    });
    if (on) {
      await this.check(host.id, userId);
    }
  }

  /**
   * Starts a check job on an Agent host, unless one is already queued or
   * running. Answers the job's id, or undefined when one was in flight.
   */
  public async check(
    hostId: string,
    userId?: string,
  ): Promise<string | undefined> {
    const host = await this.hosts.getOne({ where: { id: { eq: hostId } } });
    if (!host.agentHost) {
      throw new BadRequestError(`Host "${host.slug}" is not an Agent host`);
    }
    const inFlight = await this.jobRows.findOne({
      where: {
        hostId: { eq: hostId },
        kind: { eq: "check" },
        status: { inArray: ["queued", "running"] },
      },
    });
    if (inFlight) return undefined;
    await this.hosts.updateById(hostId, { agentStatus: "checking" });
    const job = await this.jobs.start({
      projectId: host.projectId,
      hostId,
      kind: "check",
      input: {
        timeoutSeconds: AgentHostService.CHECK_TIMEOUT_SECONDS,
      },
      startedBy: userId,
      subjectType: "host",
      subjectId: hostId,
    });
    return job.id;
  }

  /**
   * Every Agent host, checked: the daily pass.
   */
  public async checkAll(): Promise<number> {
    const agents = await this.hosts.findMany({
      where: { agentHost: { eq: true } },
    });
    let started = 0;
    for (const host of agents) {
      if (!host.jobsAllowed) continue;
      try {
        if (await this.check(host.id)) started += 1;
      } catch (error) {
        this.log.warn("An Agent host check could not start", {
          hostId: host.id,
          error,
        });
      }
    }
    return started;
  }

  /**
   * The Agent hosts a project may use: its own and those lent to it, with
   * jobs allowed (#Q4223, no default host).
   */
  public async list(projectId: number): Promise<Host[]> {
    const loans = await this.loans.findMany({
      where: { projectId: { eq: projectId } },
    });
    const candidates = await this.hosts.findMany({
      where: { agentHost: { eq: true }, jobsAllowed: { eq: true } },
    });
    const lent = new Set(loans.map((loan) => loan.hostId));
    return candidates
      .filter((host) => host.projectId === projectId || lent.has(host.id))
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /**
   * A check's end: available on exit 0, unavailable otherwise with the tail
   * of what the agent wrote on stderr, or the reason Bay gave.
   */
  protected readonly onJobEnded = $hook({
    on: "host:job:ended",
    handler: async ({ job }) => {
      if (job.kind !== "check" || !job.hostId) return;
      const passed = job.status === "succeeded";
      const errors = passed ? "" : await this.jobs.text(job.id, "stderr");
      const message = passed
        ? undefined
        : errors
            .trim()
            .split("\n")
            .filter((line) => !line.startsWith("bay: "))
            .slice(-3)
            .join("\n") ||
          job.reason ||
          `The check ended ${job.status}`;
      await this.hosts.updateById(job.hostId, {
        agentStatus: passed ? "available" : "unavailable",
        agentCheckedAt: new Date(this.dateTime.nowMillis()).toISOString(),
        agentError: message ? message.slice(0, 2000) : null,
      });
    },
  });
}
