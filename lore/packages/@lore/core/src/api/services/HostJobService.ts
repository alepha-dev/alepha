import { $hook, $inject, Alepha } from "alepha";
import { FileService } from "alepha/api/files";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { ForbiddenError, NotFoundError } from "alepha/server";

import { hostJobLogs } from "../entities/hostJobLogs.ts";
import { type HostJob, hostJobs } from "../entities/hostJobs.ts";
import { hostProjects } from "../entities/hostProjects.ts";
import { type Host, hosts } from "../entities/hosts.ts";
import { projects } from "../entities/projects.ts";
import type { HostJobKind } from "../schemas/hostJobValues.ts";
import { HOST_JOB_TERMINAL } from "../schemas/hostJobValues.ts";
import type { HostLogFrame } from "../schemas/hostLogFrameSchema.ts";
import { CoreBuckets } from "./CoreBuckets.ts";
import { HostCommandService } from "./HostCommandService.ts";
import {
  HostJobs,
  type HostJobRequest,
  type HostJobSummary,
} from "./HostJobs.ts";

/**
 * The host job queue (#Q3984): one row per run in `host_jobs`, carried to
 * the machine as a `job-run` host command, its log kept as it streams.
 *
 * Registered on core's `HostJobs` port at construction, so Build's agent
 * kind starts jobs without importing Ship.
 *
 * Rules:
 * - **One job at a time per host**, the others waiting `queued`, oldest
 *   first. Bay refuses a second `job-run` too.
 * - A host takes jobs only with `jobsAllowed`, and only for its home
 *   project or a project it is lent to.
 * - The job follows its command: `running` when the machine picks it up,
 *   then the terminal status its ack carries (`timed_out` and `cancelled`
 *   included), or `failed` when the sweep gives up on the command.
 * - At the end the log is written whole to the bucket, its rows dropped,
 *   the job's key revoked, `host:job:ended` emitted and the host's next job
 *   dispatched.
 */
export class HostJobService {
  /**
   * How long a job's log is kept in the bucket.
   */
  public static readonly LOG_TTL_DAYS = 30;

  /**
   * How far the chain guard walks `startedByJobId`.
   */
  public static readonly MAX_CHAIN = 20;

  protected readonly log = $logger();
  protected readonly jobs = $repository(hostJobs);
  protected readonly logs = $repository(hostJobLogs);
  protected readonly hosts = $repository(hosts);
  protected readonly loans = $repository(hostProjects);
  protected readonly projects = $repository(projects);
  protected readonly commands = $inject(HostCommandService);
  protected readonly files = $inject(FileService);
  protected readonly port = $inject(HostJobs);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly alepha = $inject(Alepha);

  constructor() {
    this.port.registerQueue({
      start: (request) => this.start(request),
      get: async (id) => {
        const job = await this.jobs.findOne({ where: { id: { eq: id } } });
        return job ? this.summary(job) : undefined;
      },
      active: async (projectId, subjectType, subjectId) => {
        const job = await this.jobs.findOne({
          where: {
            projectId: { eq: projectId },
            subjectType: { eq: subjectType },
            subjectId: { eq: subjectId },
            status: { inArray: ["queued", "running"] },
          },
        });
        return job ? this.summary(job) : undefined;
      },
      cancel: async (id, by) => this.summary(await this.cancel(id, by)),
      activeForAutomation: async (automationId) =>
        (
          await this.jobs.findMany({
            where: {
              automationId: { eq: automationId },
              status: { inArray: ["queued", "running"] },
            },
          })
        ).map((job) => this.summary(job)),
      chainHolds: (id, kind) => this.chainHolds(id, kind),
      removeWorkspaces: (projectId, workspace) =>
        this.removeWorkspaces(projectId, workspace),
    });
  }

  /**
   * Refuses a host that cannot run a job for this project.
   */
  public async assertRuns(host: Host, projectId: number): Promise<void> {
    if (host.type !== "bay") {
      throw new ForbiddenError(
        `Host "${host.slug}" is a Cloudflare account, which runs no job`,
      );
    }
    if (!host.jobsAllowed) {
      throw new ForbiddenError(
        `Host "${host.slug}" does not run jobs; its home project has to allow them first`,
      );
    }
    if (host.projectId !== projectId) {
      const loan = await this.loans.findOne({
        where: { hostId: { eq: host.id }, projectId: { eq: projectId } },
      });
      if (!loan) {
        throw new ForbiddenError(
          `Host "${host.slug}" is neither this project's nor lent to it`,
        );
      }
    }
  }

  /**
   * Queues a job and dispatches it when its host is free.
   */
  public async start(request: HostJobRequest): Promise<HostJobSummary> {
    const host = await this.hosts.findOne({
      where: { id: { eq: request.hostId } },
    });
    if (!host) {
      throw new NotFoundError("No such host");
    }
    await this.assertRuns(host, request.projectId);
    const created = await this.jobs.create({
      projectId: request.projectId,
      hostId: host.id,
      kind: request.kind,
      input: request.input,
      startedBy: request.startedBy,
      startedByJobId: request.startedByJobId,
      automationId: request.automationId,
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      queuedAt: this.now(),
    });
    await this.pump(host.id);
    return this.summary(await this.getRow(created.id));
  }

  /**
   * Dispatches the host's oldest queued job, unless one is running.
   */
  public async pump(hostId: string): Promise<void> {
    const running = await this.jobs.findOne({
      where: { hostId: { eq: hostId }, status: { eq: "running" } },
    });
    if (running) {
      return;
    }
    const [next] = await this.jobs.findMany({
      where: { hostId: { eq: hostId }, status: { eq: "queued" } },
      orderBy: [{ column: "queuedAt", direction: "asc" }],
      limit: 1,
    });
    if (!next) {
      return;
    }
    const host = await this.hosts.findOne({ where: { id: { eq: hostId } } });
    if (!host) {
      return;
    }
    // Claimed first, by one conditional write: a second pump racing this
    // one finds the row no longer queued.
    const claimed = await this.jobs.updateMany(
      { id: { eq: next.id }, status: { eq: "queued" } },
      { status: "running" },
    );
    if (Array.isArray(claimed) ? claimed.length === 0 : !claimed) {
      return;
    }
    try {
      const command = await this.commands.enqueue(
        host,
        {
          kind: "job-run",
          payload: { app: "", environment: "", jobId: next.id },
        },
        next.startedBy,
      );
      await this.jobs.updateById(next.id, { commandId: command.id });
    } catch (error) {
      await this.end(next.id, {
        status: "failed",
        reason:
          error instanceof Error
            ? error.message.slice(0, 2000)
            : "The host refused the job",
      });
    }
  }

  /**
   * The spec the machine pulls for a job-run, Bay's `jobSpec`, built when
   * it is pulled: the job key is minted now and exists nowhere else, and
   * the MCP URL is on the origin the machine asked on, which is the Lore it
   * is connected to (Bay refuses any URL off that origin). A second pull,
   * after a redelivery, mints a fresh key and the issuer revokes the first.
   */
  public async spec(
    job: HostJob,
    origin: string,
  ): Promise<Record<string, unknown>> {
    const input = job.input;
    // The agent CLI and its model (#Q4219): Bay builds the command line from
    // its adapter for that agent; no model leaves the CLI's own default.
    const agent = {
      agent: input.agent ?? HostJobService.DEFAULT_AGENT,
      ...(input.model ? { model: input.model } : {}),
    };
    if (job.kind === "check") {
      return {
        kind: "check",
        ...agent,
        timeoutSeconds: input.timeoutSeconds,
      };
    }
    const key = input.key
      ? await this.port.mintKey(this.summary(job), input.key)
      : undefined;
    return {
      kind: job.kind,
      ...agent,
      // The workspace directory (#Q4218): `<jobs base>/<project>/<workspace>`
      // on the host, kept between runs. Bay does no git.
      project: await this.projectDirName(job.projectId),
      workspace: input.workspace ?? HostJobService.DEFAULT_WORKSPACE,
      ...(key ? { key } : {}),
      mcpUrl: `${origin}/mcp`,
      prompt: input.prompt ?? "",
      timeoutSeconds: input.timeoutSeconds,
    };
  }

  /**
   * The agent CLI of a job that names none.
   */
  public static readonly DEFAULT_AGENT = "claude";

  /**
   * The workspace of an agent job that names none.
   */
  public static readonly DEFAULT_WORKSPACE = "default";

  /**
   * The directory a project's workspaces live under on a host: its slug,
   * or its id when it has none (Bay takes `[a-z0-9][a-z0-9_-]*`).
   */
  public async projectDirName(projectId: number): Promise<string> {
    const project = await this.projects.findOne({
      where: { id: { eq: projectId } },
    });
    const slug = project?.slug ?? "";
    return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(slug) ? slug : String(projectId);
  }

  /**
   * Asks every host that ran a job for this project to delete its job
   * workspaces, or one of them (#Q4218): a deleted project's clones, a done
   * quest's build directory. A host that is gone or refuses is skipped: the
   * workspace is disk, never data, and `bay jobs workspace rm` removes it by
   * hand.
   */
  public async removeWorkspaces(
    projectId: number,
    workspace?: string,
  ): Promise<number> {
    const ran = await this.jobs.findMany({
      where: { projectId: { eq: projectId }, kind: { eq: "agent" } },
    });
    const hostIds = [
      ...new Set(
        ran
          .filter((job) => !workspace || job.input.workspace === workspace)
          .map((job) => job.hostId)
          .filter(Boolean),
      ),
    ] as string[];
    if (!hostIds.length) return 0;
    const project = await this.projectDirName(projectId);
    let asked = 0;
    for (const host of await this.hosts.findMany({
      where: { id: { inArray: hostIds } },
    })) {
      if (host.type !== "bay") continue;
      try {
        await this.commands.enqueue(host, {
          kind: "job-workspace-remove",
          payload: {
            app: "",
            environment: "",
            project,
            ...(workspace ? { workspace } : {}),
          },
        });
        asked++;
      } catch (error) {
        this.log.warn("could not ask a host to remove job workspaces", {
          host: host.slug,
          error,
        });
      }
    }
    return asked;
  }

  /**
   * Cancels a job: a queued one ends at once, a running one is sent a
   * `job-cancel` and ends when the machine says it has.
   */
  public async cancel(jobId: string, by?: string): Promise<HostJob> {
    const job = await this.getRow(jobId);
    if (HOST_JOB_TERMINAL.includes(job.status)) {
      return job;
    }
    if (job.status === "queued" || !job.commandId) {
      return this.end(job.id, {
        status: "cancelled",
        reason: "Cancelled before it started",
      });
    }
    const host = await this.hosts.findOne({
      where: { id: { eq: job.hostId } },
    });
    if (!host) {
      throw new NotFoundError("No such host");
    }
    await this.commands.enqueue(
      host,
      {
        kind: "job-cancel",
        payload: { app: "", environment: "", jobCommandId: job.commandId },
      },
      by,
    );
    return job;
  }

  /**
   * Keeps a `log` frame of a job this host runs. Bytes the job already holds
   * for that stream are dropped, so a replay after a reconnect is harmless.
   */
  public async appendLog(host: Host, frame: HostLogFrame): Promise<void> {
    const job = await this.jobs.findOne({
      where: { commandId: { eq: frame.id }, hostId: { eq: host.id } },
    });
    if (!job || HOST_JOB_TERMINAL.includes(job.status)) {
      return;
    }
    const [last] = await this.logs.findMany({
      where: { jobId: { eq: job.id }, stream: { eq: frame.stream } },
      orderBy: [{ column: "offset", direction: "desc" }],
      limit: 1,
    });
    const held = last ? last.offset + this.bytes(last.data) : 0;
    const encoded = new TextEncoder().encode(frame.data);
    const end = frame.offset + encoded.byteLength;
    if (end > held) {
      const skip = Math.max(held - frame.offset, 0);
      const data = new TextDecoder().decode(encoded.subarray(skip));
      await this.logs.create({
        jobId: job.id,
        stream: frame.stream,
        offset: frame.offset + skip,
        data,
      });
    }
    if (frame.truncated) {
      await this.jobs.updateById(job.id, { logTruncated: true });
    }
  }

  /**
   * A job's log, or the part of one stream past `after` bytes, for its page.
   */
  public async readLog(
    jobId: string,
    after: { stdout?: number; stderr?: number } = {},
  ): Promise<{
    stdout: string;
    stderr: string;
    next: { stdout: number; stderr: number };
  }> {
    const job = await this.getRow(jobId);
    if (job.logFileId) {
      const whole = await this.stored(job);
      const out = this.tail(whole.stdout, after.stdout ?? 0);
      const err = this.tail(whole.stderr, after.stderr ?? 0);
      return {
        stdout: out,
        stderr: err,
        next: {
          stdout: this.bytes(whole.stdout),
          stderr: this.bytes(whole.stderr),
        },
      };
    }
    const rows = await this.logs.findMany({
      where: { jobId: { eq: jobId } },
      orderBy: [{ column: "offset", direction: "asc" }],
    });
    const pick = (stream: "stdout" | "stderr", from: number) => {
      let text = "";
      let next = from;
      for (const row of rows) {
        if (row.stream !== stream) continue;
        const end = row.offset + this.bytes(row.data);
        if (end <= from) continue;
        const encoded = new TextEncoder().encode(row.data);
        text += new TextDecoder().decode(
          encoded.subarray(Math.max(from - row.offset, 0)),
        );
        next = end;
      }
      return { text, next };
    };
    const out = pick("stdout", after.stdout ?? 0);
    const err = pick("stderr", after.stderr ?? 0);
    return {
      stdout: out.text,
      stderr: err.text,
      next: { stdout: out.next, stderr: err.next },
    };
  }

  /**
   * One stream of a job's log, whole.
   */
  public async text(
    jobId: string,
    stream: "stdout" | "stderr",
  ): Promise<string> {
    const log = await this.readLog(jobId);
    return log[stream];
  }

  /**
   * A project's jobs, newest first.
   */
  public async listFor(projectId: number, limit = 100): Promise<HostJob[]> {
    return this.jobs.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [{ column: "queuedAt", direction: "desc" }],
      limit,
    });
  }

  public async getRow(jobId: string): Promise<HostJob> {
    const job = await this.jobs.findOne({ where: { id: { eq: jobId } } });
    if (!job) {
      throw new NotFoundError("No such job");
    }
    return job;
  }

  /**
   * Whether the chain of jobs that started this one already holds a job
   * of this kind: an agent's output never starts its own successor.
   */
  public async chainHolds(jobId: string, kind: HostJobKind): Promise<boolean> {
    let id: string | undefined = jobId;
    for (let hop = 0; id && hop < HostJobService.MAX_CHAIN; hop += 1) {
      const job: HostJob | undefined = await this.jobs.findOne({
        where: { id: { eq: id } },
      });
      if (!job) return false;
      if (job.kind === kind) return true;
      id = job.startedByJobId;
    }
    return id !== undefined;
  }

  /**
   * Every host with a queued job and nothing running, dispatched. What the
   * quarter-hour job runs, so nothing waits on an ack that was lost.
   */
  public async sweep(): Promise<void> {
    const queued = await this.jobs.findMany({
      where: { status: { eq: "queued" } },
      columns: ["hostId"],
    });
    for (const hostId of new Set(queued.map((row) => row.hostId))) {
      await this.pump(hostId);
    }
  }

  /**
   * The job follows its command: the machine's pickup, then its end.
   */
  protected readonly onCommandProgressed = $hook({
    on: "host:command:progressed",
    handler: async ({ command, jobOutcome, exitCode }) => {
      if (command.kind !== "job-run") return;
      const job = await this.jobs.findOne({
        where: { commandId: { eq: command.id } },
      });
      if (!job || HOST_JOB_TERMINAL.includes(job.status)) return;
      if (command.status === "running") {
        if (!job.startedAt) {
          await this.jobs.updateById(job.id, { startedAt: this.now() });
        }
        return;
      }
      if (command.status !== "done" && command.status !== "failed") return;
      const status =
        jobOutcome === "timed_out" || jobOutcome === "cancelled"
          ? jobOutcome
          : command.status === "done"
            ? "succeeded"
            : "failed";
      await this.end(job.id, {
        status,
        reason: command.reason,
        exitCode,
      });
    },
  });

  /**
   * Ends a job: the log to the bucket, the key revoked, the event, and the
   * host's next job.
   */
  protected async end(
    jobId: string,
    outcome: {
      status: "succeeded" | "failed" | "cancelled" | "timed_out";
      reason?: string;
      exitCode?: number;
    },
  ): Promise<HostJob> {
    const job = await this.getRow(jobId);
    await this.jobs.updateById(job.id, {
      status: outcome.status,
      endedAt: this.now(),
      ...(outcome.reason ? { reason: outcome.reason.slice(0, 2000) } : {}),
      ...(outcome.exitCode === undefined ? {} : { exitCode: outcome.exitCode }),
    });
    await this.archive(job.id);
    await this.port.revokeKey(job.id);
    const ended = await this.getRow(job.id);
    await this.alepha.events.emit("host:job:ended", {
      job: this.summary(ended),
    });
    await this.pump(job.hostId);
    return ended;
  }

  /**
   * Writes the whole log to the bucket and drops its rows.
   */
  protected async archive(jobId: string): Promise<void> {
    const rows = await this.logs.findMany({
      where: { jobId: { eq: jobId } },
      orderBy: [{ column: "offset", direction: "asc" }],
    });
    const whole = {
      stdout: rows
        .filter((row) => row.stream === "stdout")
        .map((row) => row.data)
        .join(""),
      stderr: rows
        .filter((row) => row.stream === "stderr")
        .map((row) => row.data)
        .join(""),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(whole));
    try {
      const stored = await this.files.uploadFile(
        new File([bytes], `job-${jobId}.json`, { type: "application/json" }),
        {
          bucket: CoreBuckets.JOB_LOG_BUCKET,
          expirationDate: new Date(
            this.dateTime.nowMillis() +
              HostJobService.LOG_TTL_DAYS * 86_400_000,
          ).toISOString(),
        },
      );
      await this.jobs.updateById(jobId, {
        logFileId: stored.id,
        logBytes: this.bytes(whole.stdout) + this.bytes(whole.stderr),
      });
      await this.logs.deleteMany({ jobId: { eq: jobId } });
    } catch (error) {
      // The rows stay: the page reads them as before.
      this.log.warn("A job's log could not be stored in the bucket", {
        jobId,
        error,
      });
    }
  }

  protected async stored(
    job: HostJob,
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      const file = await this.files.streamFile(job.logFileId as string, {
        bucket: CoreBuckets.JOB_LOG_BUCKET,
      });
      const parsed = JSON.parse(await file.text()) as {
        stdout?: string;
        stderr?: string;
      };
      return { stdout: parsed.stdout ?? "", stderr: parsed.stderr ?? "" };
    } catch {
      return { stdout: "", stderr: "" };
    }
  }

  protected tail(text: string, after: number): string {
    const encoded = new TextEncoder().encode(text);
    return new TextDecoder().decode(encoded.subarray(after));
  }

  protected bytes(text: string): number {
    return new TextEncoder().encode(text).byteLength;
  }

  public summary(job: HostJob): HostJobSummary {
    return {
      id: job.id,
      projectId: job.projectId,
      hostId: job.hostId,
      kind: job.kind,
      status: job.status,
      startedBy: job.startedBy,
      startedByJobId: job.startedByJobId,
      automationId: job.automationId,
      subjectType: job.subjectType,
      subjectId: job.subjectId,
      reason: job.reason,
      exitCode: job.exitCode,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
      input: job.input,
    };
  }

  protected now(): string {
    return new Date(this.dateTime.nowMillis()).toISOString();
  }
}
