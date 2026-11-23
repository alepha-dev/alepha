import { $hook, $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { BadRequestError, ForbiddenError } from "alepha/server";

import { hostJobs } from "../entities/hostJobs.ts";
import { hostProjects } from "../entities/hostProjects.ts";
import { type Host, hosts } from "../entities/hosts.ts";
import { projects } from "../entities/projects.ts";
import { HostJobs } from "./HostJobs.ts";
import { HostJobService } from "./HostJobService.ts";

/**
 * Agent hosts (#Q3985): hosts that run Claude Code jobs, and Lore's check
 * that they still can.
 *
 * Hosts stay what they are (review answer 1): one boolean, `agentHost`, on
 * a host that already runs jobs (`jobsAllowed`). Its operator sets Claude
 * Code up by hand for Bay's jobs user; Lore never configures it and never
 * sees the credential. What Lore does is ask: a **check job**, Claude Code
 * told to reply OK in one turn with nothing in reach, whose output gives the
 * CLI's version, the model, the kind of credential and, on a failure, the
 * CLI's own message.
 *
 * A check runs when a host becomes an Agent host, once a day, on demand, and
 * whenever an agent job fails on an auth or usage-limit message
 * ({@link recheck}). A failing check marks the host `unavailable` with the
 * message; the next passing one clears it, which is how a usage limit lifts.
 *
 * Each project names one default Agent host (`projects.defaultAgentHostId`),
 * its own or a lent one, for its agent jobs; without one the agent buttons
 * are hidden.
 */
export class AgentHostService {
  /**
   * A check's budget: one turn, and two minutes for a cold CLI.
   */
  public static readonly CHECK_TIMEOUT_SECONDS = 120;

  protected readonly log = $logger();
  protected readonly hosts = $repository(hosts);
  protected readonly loans = $repository(hostProjects);
  protected readonly projects = $repository(projects);
  protected readonly jobRows = $repository(hostJobs);
  protected readonly jobs = $inject(HostJobService);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly port = $inject(HostJobs);

  constructor() {
    // Build's agent kind finds its host, and asks for a recheck, through the
    // port: no feature module imports another.
    this.port.registerAgentHosts({
      defaultFor: async (projectId) => {
        const host = await this.defaultFor(projectId);
        return host
          ? {
              id: host.id,
              slug: host.slug,
              ...(host.agentStatus ? { status: host.agentStatus } : {}),
              ...(host.jobsRunner ? { runner: host.jobsRunner } : {}),
            }
          : undefined;
      },
      recheck: (hostId) => this.recheck(hostId),
    });
  }

  /**
   * Makes a host an Agent host or not. On, it needs `jobsAllowed` and a
   * check starts at once; off, every project that named it as its default
   * forgets it.
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
      return;
    }
    await this.projects.updateMany(
      { defaultAgentHostId: { eq: host.id } },
      { defaultAgentHostId: null },
    );
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
        profile: "check",
        maxTurns: 1,
        timeoutSeconds: AgentHostService.CHECK_TIMEOUT_SECONDS,
      },
      startedBy: userId,
      subjectType: "host",
      subjectId: hostId,
    });
    return job.id;
  }

  /**
   * What an agent job calls when it failed on an auth or usage-limit
   * message: the host is checked again, so its state says why.
   */
  public async recheck(hostId: string): Promise<void> {
    await this.check(hostId).catch((error) => {
      this.log.warn("An Agent host recheck could not start", {
        hostId,
        error,
      });
    });
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
   * Names the project's default Agent host, or clears it. The host must be
   * an Agent host, and the project's own or lent to it.
   */
  public async setDefault(
    projectId: number,
    hostId: string | null,
  ): Promise<void> {
    if (hostId) {
      const host = await this.usable(projectId, hostId);
      if (!host) {
        throw new ForbiddenError(
          "That host is not an Agent host this project can use",
        );
      }
    }
    await this.projects.updateById(projectId, { defaultAgentHostId: hostId });
  }

  /**
   * The project's default Agent host when it is still one it may use, or
   * undefined: what every agent job reads before it starts.
   */
  public async defaultFor(projectId: number): Promise<Host | undefined> {
    const project = await this.projects.findOne({
      where: { id: { eq: projectId } },
    });
    if (!project?.defaultAgentHostId) return undefined;
    return this.usable(projectId, project.defaultAgentHostId);
  }

  protected async usable(
    projectId: number,
    hostId: string,
  ): Promise<Host | undefined> {
    const host = await this.hosts.findOne({ where: { id: { eq: hostId } } });
    if (!host?.agentHost || !host.jobsAllowed) return undefined;
    if (host.projectId === projectId) return host;
    const loan = await this.loans.findOne({
      where: { hostId: { eq: hostId }, projectId: { eq: projectId } },
    });
    return loan ? host : undefined;
  }

  /**
   * A check's end: the host's state from what the CLI printed.
   */
  protected readonly onJobEnded = $hook({
    on: "host:job:ended",
    handler: async ({ job }) => {
      if (job.kind !== "check" || !job.hostId) return;
      const output = await this.jobs.text(job.id, "stdout");
      const errors = await this.jobs.text(job.id, "stderr");
      const read = this.read(output);
      const passed =
        job.status === "succeeded" && read.ok && read.isError !== true;
      const message = passed
        ? undefined
        : (read.isError ? read.text : undefined) ||
          errors.trim().split("\n").slice(-3).join("\n") ||
          job.reason ||
          `The check ended ${job.status}`;
      await this.hosts.updateById(job.hostId, {
        agentStatus: passed ? "available" : "unavailable",
        agentCheckedAt: new Date(this.dateTime.nowMillis()).toISOString(),
        agentError: message ? message.slice(0, 2000) : null,
        ...(read.version
          ? { agentCliVersion: read.version.slice(0, 100) }
          : {}),
        ...(read.model ? { agentModel: read.model.slice(0, 100) } : {}),
        ...(read.credential ? { agentCredential: read.credential } : {}),
      });
    },
  });

  /**
   * What a check's stream-json output says: the init line (version, model,
   * where the key came from), then the result (`is_error`, its text, the
   * models it used). Lines that are not JSON are skipped.
   */
  public read(output: string): {
    ok: boolean;
    isError?: boolean;
    text?: string;
    version?: string;
    model?: string;
    credential?: "oauth" | "api_key";
  } {
    const out: ReturnType<AgentHostService["read"]> = { ok: false };
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (event.type === "system" && event.subtype === "init") {
        if (typeof event.claude_code_version === "string") {
          out.version = event.claude_code_version;
        }
        if (typeof event.model === "string") out.model = event.model;
        if (typeof event.apiKeySource === "string") {
          // `none` is a login or a setup-token (OAuth); anything else names
          // where an API key came from.
          out.credential = event.apiKeySource === "none" ? "oauth" : "api_key";
        }
      }
      if (event.type === "result") {
        out.ok = true;
        out.isError = event.is_error === true;
        if (typeof event.result === "string") out.text = event.result;
        const usage = event.modelUsage;
        if (usage && typeof usage === "object") {
          const [first] = Object.keys(usage as Record<string, unknown>);
          if (first) out.model = first;
        }
      }
    }
    return out;
  }
}
