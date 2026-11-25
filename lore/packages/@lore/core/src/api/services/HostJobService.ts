import { $hook, $inject, Alepha } from "alepha";
import { FileService } from "alepha/api/files";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, DbConflictError } from "alepha/orm";
import { ForbiddenError, NotFoundError } from "alepha/server";

import { hostJobLogs } from "../entities/hostJobLogs.ts";
import { type HostJob, hostJobs } from "../entities/hostJobs.ts";
import { hostProjects } from "../entities/hostProjects.ts";
import { type Host, hosts } from "../entities/hosts.ts";
import { projects } from "../entities/projects.ts";
import { AgentTranscript } from "../schemas/AgentTranscript.ts";
import type { HostJobTotals } from "../schemas/hostJobTotalsSchema.ts";
import type { HostJobKind } from "../schemas/hostJobValues.ts";
import { HOST_JOB_TERMINAL } from "../schemas/hostJobValues.ts";
import type { HostLogFrame } from "../schemas/hostLogFrameSchema.ts";
import { jobRepositoryOf } from "../schemas/jobRepository.ts";
import { BoundParameters } from "./BoundParameters.ts";
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
 * - **Up to the host's `--max-jobs` at a time** (#Q4249, one when it reports
 *   none), the others waiting `queued`, oldest first. A queued job whose
 *   workspace a running write job holds waits for it. A job the host acks
 *   `busy` (its slots full, its workspace held) goes back to the queue and is
 *   dispatched again only once a job of that host ends.
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
  protected readonly bound = $inject(BoundParameters);
  protected readonly files = $inject(FileService);
  protected readonly port = $inject(HostJobs);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly alepha = $inject(Alepha);

  constructor() {
    this.port.registerQueue({
      start: (request) => this.start(request),
      text: (id, stream) => this.text(id, stream),
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
      ...(request.id ? { id: request.id } : {}),
      projectId: request.projectId,
      hostId: host.id,
      kind: request.kind,
      input: request.input,
      startedBy: request.startedBy,
      startedByJobId: request.startedByJobId,
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      ...(request.prompt ? { prompt: request.prompt } : {}),
      ...(request.args ? { args: request.args } : {}),
      ...(request.cause ? { cause: request.cause } : {}),
      queuedAt: this.now(),
    });
    await this.pump(host.id);
    return this.summary(await this.getRow(created.id));
  }

  /**
   * Dispatches the host's oldest queued jobs, up to its free slots: its
   * `--max-jobs` (#Q4249) less what runs. A job the host acked busy waits
   * for a job of that host to end ({@link end} clears it), and a job whose
   * workspace a running write job holds waits for that job.
   */
  public async pump(hostId: string): Promise<void> {
    const host = await this.hosts.findOne({ where: { id: { eq: hostId } } });
    if (!host) {
      return;
    }
    const running = await this.jobs.findMany({
      where: { hostId: { eq: hostId }, status: { eq: "running" } },
    });
    let free = Math.max(1, host.jobsMaxJobs ?? 1) - running.length;
    if (free <= 0) {
      return;
    }
    const queued = await this.jobs.findMany({
      where: { hostId: { eq: hostId }, status: { eq: "queued" } },
      orderBy: [{ column: "queuedAt", direction: "asc" }],
      limit: 50,
    });
    const held = new Set(
      running
        .filter((job) => job.input.source?.mode === "write")
        .map((job) => `${job.projectId}/${job.input.workspace ?? ""}`),
    );
    for (const next of queued) {
      if (free <= 0) break;
      if (next.busyAt) continue;
      const workspace = `${next.projectId}/${next.input.workspace ?? ""}`;
      if (next.kind === "agent" && held.has(workspace)) continue;
      // Claimed first, by one conditional write: a second pump racing this
      // one finds the row no longer queued.
      const claimed = await this.jobs.updateMany(
        { id: { eq: next.id }, status: { eq: "queued" } },
        { status: "running" },
      );
      if (Array.isArray(claimed) ? claimed.length === 0 : !claimed) {
        continue;
      }
      free -= 1;
      if (next.input.source?.mode === "write") held.add(workspace);
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
  }

  /**
   * How long a job acked busy waits for one of its host's jobs to end
   * before the sweep offers it again: a host whose jobs Lore did not start
   * (its operator's own) ends none Lore hears of.
   */
  public static readonly BUSY_WAIT_MS = 15 * 60_000;

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
    const source = await this.sourceSpec(job);
    return {
      kind: job.kind,
      ...agent,
      // The workspace directory (#Q4218): `<jobs base>/<project>/<workspace>`
      // on the host, kept between runs; its code is the source's (#E173).
      project: await this.projectDirName(job.projectId),
      workspace: input.workspace ?? HostJobService.DEFAULT_WORKSPACE,
      ...(source ? { source } : {}),
      ...(input.output ? { output: input.output } : {}),
      ...(input.session ? { session: input.session } : {}),
      ...(key ? { key } : {}),
      mcpUrl: `${origin}/mcp`,
      prompt: input.prompt ?? "",
      timeoutSeconds: input.timeoutSeconds,
    };
  }

  /**
   * A job's `source` as Bay reads it (#E173): its mode, ref and branch, and
   * the project's repository as it is when the host pulls the spec. None is
   * left out, so a `none` job reaches a Bay older than sources unchanged.
   */
  protected async sourceSpec(
    job: HostJob,
  ): Promise<Record<string, unknown> | undefined> {
    const source = job.input.source;
    if (!source || source.mode === "none") return undefined;
    const project = await this.projects.findOne({
      where: { id: { eq: job.projectId } },
    });
    const github = jobRepositoryOf(project?.repositoryUrl);
    const repository = github ? (this.localRepository() ?? github) : undefined;
    return {
      mode: source.mode,
      ...(repository ? { repository } : {}),
      ...(source.ref ? { ref: source.ref } : {}),
      ...(source.branch ? { branch: source.branch } : {}),
      ...(source.trust ? { trust: source.trust } : {}),
      // A continued write job (#Q4340): sent only then, since a Bay before
      // it refuses the field.
      ...(source.resume ? { resume: true } : {}),
    };
  }

  /**
   * The local repository a spec names in place of the project's GitHub one:
   * the e2e suite's way in (`JOBS_DEV_REPOSITORY_PATH`), with a dev Bay that
   * accepts a path (BAY_DEV_JOBS_AS_SELF). Nothing else sets it, and a
   * released Bay refuses a path whatever Lore sends.
   */
  protected localRepository(): string | undefined {
    const path = this.alepha.env.JOBS_DEV_REPOSITORY_PATH;
    return typeof path === "string" && path.startsWith("/") ? path : undefined;
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
   * Keeps a `log` frame of a job this host runs, one row per offset
   * ({@link keepFrame}), so a replay after a reconnect is harmless; a frame
   * overlapping another at a different offset is resolved when the log is
   * read ({@link assemble}).
   *
   * ⚠️ Never "drop what ends before the last row" (#Q4296): Bay sends up to
   * 64 frames at once and they are kept concurrently, so a frame can land
   * after the one that follows it. That rule threw the earlier frame away,
   * 16 KB cut out of the middle of a long line, which the transcript then
   * printed raw.
   */
  public async appendLog(host: Host, frame: HostLogFrame): Promise<void> {
    const job = await this.jobs.findOne({
      where: { commandId: { eq: frame.id }, hostId: { eq: host.id } },
    });
    if (!job || HOST_JOB_TERMINAL.includes(job.status)) {
      return;
    }
    await this.keepFrame(job.id, frame);
    if (frame.truncated) {
      await this.jobs.updateById(job.id, { logTruncated: true });
    }
  }

  /**
   * A job's log, or the part of one stream past `after` bytes, for its page.
   */
  /**
   * The model a job ran on (#Q4304): the one its input named, or, for an
   * agent job that ended without naming one, the one its agent CLI reported
   * at its start. An ended job's log no longer moves, so reading it once
   * here is the cost of a page open, never of a running job's poll.
   */
  public async modelOf(job: HostJob): Promise<string | undefined> {
    const input = job.input as { model?: string; agent?: string } | undefined;
    if (input?.model) return input.model;
    if (job.kind !== "agent" || !HOST_JOB_TERMINAL.includes(job.status)) {
      return undefined;
    }
    const log = await this.readLog(job.id);
    return AgentTranscript.sessionModel(log.stdout, input?.agent);
  }

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
    const out = this.assemble(rows, "stdout", after.stdout ?? 0);
    const err = this.assemble(rows, "stderr", after.stderr ?? 0);
    return {
      stdout: out.text,
      stderr: err.text,
      next: { stdout: out.next, stderr: err.next },
    };
  }

  /**
   * One frame's row, keyed by its offset (unique per job and stream): kept
   * when the offset is new, its data replaced when a replay at the same
   * offset carries more, and nothing done when the row holds as much. A
   * conflict is the same frame kept concurrently: read it back and retry
   * once.
   */
  protected async keepFrame(
    jobId: string,
    frame: HostLogFrame,
    retry = true,
  ): Promise<void> {
    const length = this.bytes(frame.data);
    if (length === 0) return;
    const held = await this.logs.findOne({
      where: {
        jobId: { eq: jobId },
        stream: { eq: frame.stream },
        offset: { eq: frame.offset },
      },
    });
    if (held) {
      if (this.bytes(held.data) < length) {
        await this.logs.updateById(held.id, { data: frame.data });
      }
      return;
    }
    try {
      await this.logs.create({
        jobId,
        stream: frame.stream,
        offset: frame.offset,
        data: frame.data,
      });
    } catch (error) {
      if (!retry || !(error instanceof DbConflictError)) throw error;
      await this.keepFrame(jobId, frame, false);
    }
  }

  /**
   * One stream of the log rows, past `from` bytes, in offset order: each
   * byte once, whatever the rows overlap (a replay, a longer frame at the
   * same offset), and the bytes past what the stream holds as `next`.
   */
  protected assemble(
    rows: Array<{ stream: string; offset: number; data: string }>,
    stream: "stdout" | "stderr",
    from: number,
  ): { text: string; next: number } {
    let text = "";
    let next = from;
    for (const row of [...rows].sort((a, b) => a.offset - b.offset)) {
      if (row.stream !== stream) continue;
      const end = row.offset + this.bytes(row.data);
      if (end <= next) continue;
      const encoded = new TextEncoder().encode(row.data);
      text += new TextDecoder().decode(
        encoded.subarray(Math.max(next - row.offset, 0)),
      );
      next = end;
    }
    return { text, next };
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
   * Every host with a queued job, dispatched up to its free slots. What the
   * quarter-hour job runs, so nothing waits on an ack that was lost.
   */
  public async sweep(): Promise<void> {
    // A busy job whose host ended nothing Lore heard of in a while is
    // offered again: once per sweep at most, never in a loop.
    const stale = new Date(
      this.dateTime.nowMillis() - HostJobService.BUSY_WAIT_MS,
    ).toISOString();
    await this.jobs.updateMany(
      { status: { eq: "queued" }, busyAt: { lt: stale } },
      { busyAt: null },
    );
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
    handler: async ({
      command,
      jobOutcome,
      exitCode,
      commit,
      warning,
      result,
      resultTruncated,
      totals,
    }) => {
      if (command.kind !== "job-run") return;
      const job = await this.jobs.findOne({
        where: { commandId: { eq: command.id } },
      });
      if (!job || HOST_JOB_TERMINAL.includes(job.status)) return;
      if (command.status === "failed" && command.step === "busy") {
        // Not started yet, not failed (#Q4249): back to the queue, until a
        // job of this host ends. Never a retry loop.
        await this.jobs.updateById(job.id, {
          status: "queued",
          commandId: null,
          startedAt: null,
          busyAt: this.now(),
        });
        return;
      }
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
        commit,
        warning,
        result,
        resultTruncated,
        totals,
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
      commit?: string;
      warning?: string;
      result?: string;
      resultTruncated?: boolean;
      totals?: HostJobTotals;
    },
  ): Promise<HostJob> {
    const job = await this.getRow(jobId);
    await this.jobs.updateById(job.id, {
      status: outcome.status,
      endedAt: this.now(),
      ...(outcome.reason ? { reason: outcome.reason.slice(0, 2000) } : {}),
      ...(outcome.exitCode === undefined ? {} : { exitCode: outcome.exitCode }),
      ...(outcome.commit ? { commit: outcome.commit } : {}),
      ...(outcome.warning ? { warning: outcome.warning.slice(0, 2000) } : {}),
      // The agent's final reply (#Q4288), kept with the job (#Q4275).
      ...(outcome.result === undefined
        ? {}
        : {
            result: outcome.result.slice(0, 32_768),
            ...(outcome.resultTruncated ? { resultTruncated: true } : {}),
          }),
      // What the run cost, as its agent CLI said (#Q4293): null for a Bay
      // that sends none, so the job page reads the log instead.
      ...(outcome.totals?.turns === undefined
        ? {}
        : { turns: outcome.totals.turns }),
      ...(outcome.totals?.inputTokens === undefined
        ? {}
        : { inputTokens: outcome.totals.inputTokens }),
      ...(outcome.totals?.outputTokens === undefined
        ? {}
        : { outputTokens: outcome.totals.outputTokens }),
      ...(outcome.totals?.costUsd === undefined
        ? {}
        : { costUsd: outcome.totals.costUsd }),
    });
    await this.archive(job);
    await this.port.revokeKey(job.id);
    const ended = await this.getRow(job.id);
    await this.alepha.events.emit("host:job:ended", {
      job: this.summary(ended),
    });
    // A job of this host ended: what it acked busy may start now (#Q4249).
    await this.jobs.updateMany(
      {
        hostId: { eq: job.hostId },
        status: { eq: "queued" },
        busyAt: { isNotNull: true },
      },
      { busyAt: null },
    );
    await this.pump(job.hostId);
    return ended;
  }

  /**
   * Writes the whole log to the bucket and drops its rows.
   */
  protected async archive(job: HostJob): Promise<void> {
    const jobId = job.id;
    const rows = await this.logs.findMany({
      where: { jobId: { eq: jobId } },
      orderBy: [{ column: "offset", direction: "asc" }],
    });
    const whole = {
      stdout: this.assemble(rows, "stdout", 0).text,
      stderr: this.assemble(rows, "stderr", 0).text,
    };
    this.reportTranscript(job, whole.stdout);
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

  /**
   * The lines of an ended agent job's log its transcript does not read
   * (#Q4296), logged at error level so the sigil files them in Errors: the
   * page leaves them out, and this is how a format the parser lacks gets
   * noticed. Once per job and kind, here at its end rather than on each
   * render or poll; the message names the kind only, so one kind is one
   * error, and the data carries the job and a short sample, never the line.
   */
  protected reportTranscript(job: HostJob, stdout: string): void {
    if (job.kind !== "agent") return;
    const agent = (job.input as { agent?: string } | undefined)?.agent;
    const transcript = AgentTranscript.parse(stdout, agent);
    for (const miss of transcript.unknown ?? []) {
      this.log.error(`Agent transcript row not supported: ${miss.kind}`, {
        jobId: job.id,
        agent: agent ?? "claude",
        kind: miss.kind,
        count: miss.count,
        sample: miss.sample,
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
      subjectType: job.subjectType,
      subjectId: job.subjectId,
      reason: job.reason,
      exitCode: job.exitCode,
      commit: job.commit,
      warning: job.warning,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
      input: job.input,
      ...(job.prompt ? { prompt: job.prompt } : {}),
      ...(job.args ? { args: job.args } : {}),
      ...(job.cause ? { cause: job.cause } : {}),
      ...(job.result === undefined || job.result === null
        ? {}
        : { result: job.result }),
      ...(job.resultTruncated ? { resultTruncated: true } : {}),
    };
  }

  protected now(): string {
    return new Date(this.dateTime.nowMillis()).toISOString();
  }
}
