import {
  HostJobs,
  HostCommandTransport,
  HostCommandService,
  HostJobService,
} from "@lore/core/api";
import {
  jobKeys,
  hostCommands,
  hostJobLogs,
  hostJobs,
  type Host,
  hosts,
} from "@lore/core/schemas";
// Its own subpath: `./testing` is loaded by browser specs, and this one
// boots the host controllers (#E166).
import { createTestHost } from "@lore/core/testing/hosts";
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

/**
 * Every push answers "connected", so a command goes straight to `sent`.
 */
class ConnectedTransport extends HostCommandTransport {
  public readonly pushed: unknown[] = [];
  override async push(_host: Host, frame: unknown): Promise<boolean> {
    this.pushed.push(frame);
    return true;
  }
}

class Repos {
  hosts = $repository(hosts);
  jobs = $repository(hostJobs);
  logs = $repository(hostJobLogs);
  commands = $repository(hostCommands);
  keys = $repository(jobKeys);
}

const input = {
  workspace: "triage",
  prompt: "Triage the inbox.",
  timeoutSeconds: 900,
};

const setup = async (env: Record<string, string> = {}) => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:", ...env },
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
  const service = alepha.inject(HostJobService);
  const commands = alepha.inject(HostCommandService);
  const user = await entities.users.create({});
  const owner: UserAccountToken = { id: user.id, roles: ["user"] };
  const minted = await createTestHost(alepha, owner, { slug: "agent-1" });
  await repos.hosts.updateById(minted.id, { jobsAllowed: true });
  const host = await repos.hosts.getOne({ where: { id: { eq: minted.id } } });
  return {
    alepha,
    service,
    commands,
    repos,
    host,
    projectId: minted.projectId,
    ownerId: user.id,
  };
};

type World = Awaited<ReturnType<typeof setup>>;

const start = (w: World) =>
  w.service.start({
    projectId: w.projectId,
    hostId: w.host.id,
    kind: "agent",
    input,
    startedBy: w.ownerId,
  });

const commandOf = async (w: World, jobId: string) => {
  const job = await w.repos.jobs.getOne({ where: { id: { eq: jobId } } });
  if (!job.commandId) throw new Error("the job has no command");
  return w.repos.commands.getOne({ where: { id: { eq: job.commandId } } });
};

describe("HostJobService", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });

  it("asks every host that ran the project's agent jobs to delete its workspaces (#Q4218)", async ({
    expect,
  }) => {
    expect(await w.service.removeWorkspaces(w.projectId)).toBe(0);
    await start(w);
    // A workspace no job of the project ran in asks no host.
    expect(await w.service.removeWorkspaces(w.projectId, "q12")).toBe(0);
    await w.service.start({
      projectId: w.projectId,
      hostId: w.host.id,
      kind: "agent",
      input: { ...input, workspace: "q12" },
      startedBy: w.ownerId,
    });
    expect(await w.service.removeWorkspaces(w.projectId, "q12")).toBe(1);
    const asked = await w.repos.commands.findMany({
      where: {
        hostId: { eq: w.host.id },
        kind: { eq: "job-workspace-remove" },
      },
    });
    expect(asked).toHaveLength(1);
    const project = await w.service.projectDirName(w.projectId);
    expect(asked[0]?.payload).toMatchObject({ project, workspace: "q12" });
    // Held to no switch: a host whose jobs were turned off still holds them.
    await w.repos.hosts.updateById(w.host.id, { jobsAllowed: false });
    expect(await w.service.removeWorkspaces(w.projectId)).toBe(1);
  });

  it("dispatches one job at a time per host, the others waiting in order", async ({
    expect,
  }) => {
    const first = await start(w);
    const second = await start(w);
    expect(first.status).toBe("running");
    expect(second.status).toBe("queued");
    const command = await commandOf(w, first.id);
    expect(command.kind).toBe("job-run");
    expect(command.payload.jobId).toBe(first.id);

    await w.commands.ack(w.host.id, { id: command.id, status: "running" });
    await w.commands.ack(w.host.id, {
      id: command.id,
      status: "done",
      exitCode: 0,
    });
    const ended = await w.repos.jobs.getOne({
      where: { id: { eq: first.id } },
    });
    expect(ended.status).toBe("succeeded");
    expect(ended.exitCode).toBe(0);
    expect(ended.startedAt).toBeDefined();
    const next = await w.repos.jobs.getOne({
      where: { id: { eq: second.id } },
    });
    expect(next.status).toBe("running");
  });

  it("dispatches up to the host's --max-jobs, and never two jobs into a workspace a write job holds (#Q4249)", async ({
    expect,
  }) => {
    await w.repos.hosts.updateById(w.host.id, { jobsMaxJobs: 3 });
    const startWith = (extra: Record<string, unknown>) =>
      w.service.start({
        projectId: w.projectId,
        hostId: w.host.id,
        kind: "agent",
        input: { ...input, ...extra },
        startedBy: w.ownerId,
      });
    const write = await startWith({
      workspace: "q1",
      source: { mode: "write", branch: "lore/q1" },
    });
    const sameWorkspace = await startWith({ workspace: "q1" });
    const read = await startWith({
      workspace: "triage",
      source: { mode: "read" },
    });
    const third = await startWith({
      workspace: "review",
      source: { mode: "read" },
    });
    const fourth = await startWith({ workspace: "text" });
    expect(write.status).toBe("running");
    // Its workspace is held by a running write job: it waits, and the
    // others behind it go first.
    expect(sameWorkspace.status).toBe("queued");
    expect(read.status).toBe("running");
    expect(third.status).toBe("running");
    // Three slots, three running.
    expect(fourth.status).toBe("queued");

    await w.commands.ack(w.host.id, {
      id: (await commandOf(w, write.id)).id,
      status: "done",
      exitCode: 0,
    });
    const after = await w.repos.jobs.findMany({
      where: { id: { inArray: [sameWorkspace.id, fourth.id] } },
    });
    // One slot freed: the oldest waiting job takes it, now its workspace
    // is free.
    expect(after.find((it) => it.id === sameWorkspace.id)?.status).toBe(
      "running",
    );
    expect(after.find((it) => it.id === fourth.id)?.status).toBe("queued");
  });

  it("puts a job the host acked busy back in the queue, offered again only once a job of the host ends (#Q4249)", async ({
    expect,
  }) => {
    await w.repos.hosts.updateById(w.host.id, { jobsMaxJobs: 2 });
    const a = await start(w);
    const b = await start(w);
    const busyCommand = await commandOf(w, b.id);
    await w.commands.ack(w.host.id, {
      id: busyCommand.id,
      status: "failed",
      step: "busy",
      reason: "a job already runs in the workspace acme/triage: one at a time",
    });
    const requeued = await w.repos.jobs.getOne({ where: { id: { eq: b.id } } });
    expect(requeued.status).toBe("queued");
    expect(requeued.busyAt).toBeDefined();
    expect(requeued.commandId ?? undefined).toBeUndefined();
    // A new job, a sweep: neither retries it while its host ends nothing.
    await w.service.sweep();
    await start(w);
    expect(
      (await w.repos.jobs.getOne({ where: { id: { eq: b.id } } })).status,
    ).toBe("queued");

    await w.commands.ack(w.host.id, {
      id: (await commandOf(w, a.id)).id,
      status: "done",
      exitCode: 0,
    });
    const again = await w.repos.jobs.getOne({ where: { id: { eq: b.id } } });
    expect(again.status).toBe("running");
    expect(again.busyAt ?? undefined).toBeUndefined();
    expect(again.commandId).not.toBe(busyCommand.id);
  });

  it("refuses a host whose jobs are off", async ({ expect }) => {
    await w.repos.hosts.updateById(w.host.id, { jobsAllowed: false });
    await expect(start(w)).rejects.toThrow("does not run jobs");
  });

  it("refuses a project the host is not lent to", async ({ expect }) => {
    await expect(
      w.service.start({
        projectId: w.projectId + 1000,
        hostId: w.host.id,
        kind: "agent",
        input,
      }),
    ).rejects.toThrow("neither this project's nor lent to it");
  });

  it("keeps a timeout and a cancel apart from a failure", async ({
    expect,
  }) => {
    const job = await start(w);
    const command = await commandOf(w, job.id);
    await w.commands.ack(w.host.id, {
      id: command.id,
      status: "timed_out",
      reason: "past its timeout",
    });
    const ended = await w.repos.jobs.getOne({ where: { id: { eq: job.id } } });
    expect(ended.status).toBe("timed_out");
    const row = await commandOf(w, job.id);
    expect(row.status).toBe("failed");
  });

  it("keeps each byte of the log once, replays included, and stores it whole at the end", async ({
    expect,
  }) => {
    const job = await start(w);
    const command = await commandOf(w, job.id);
    const frame = (offset: number, data: string) => ({
      type: "log" as const,
      id: command.id,
      stream: "stdout" as const,
      offset,
      data,
    });
    await w.service.appendLog(w.host, frame(0, "one\n"));
    await w.service.appendLog(w.host, frame(4, "two\n"));
    // A reconnect sends the last frames again, overlapping what is held.
    await w.service.appendLog(w.host, frame(0, "one\ntwo\nthree\n"));
    const live = await w.service.readLog(job.id);
    expect(live.stdout).toBe("one\ntwo\nthree\n");
    const tail = await w.service.readLog(job.id, { stdout: 4 });
    expect(tail.stdout).toBe("two\nthree\n");

    await w.commands.ack(w.host.id, { id: command.id, status: "done" });
    const ended = await w.repos.jobs.getOne({ where: { id: { eq: job.id } } });
    expect(ended.logFileId).toBeDefined();
    expect(
      await w.repos.logs.findMany({ where: { jobId: { eq: job.id } } }),
    ).toHaveLength(0);
    expect((await w.service.readLog(job.id)).stdout).toBe("one\ntwo\nthree\n");
  });

  it("keeps a frame that lands after the one following it, so a long line is never cut (#Q4296)", async ({
    expect,
  }) => {
    const job = await start(w);
    const command = await commandOf(w, job.id);
    const frame = (offset: number, data: string) => ({
      type: "log" as const,
      id: command.id,
      stream: "stdout" as const,
      offset,
      data,
    });
    // Bay sends a burst of frames and they are kept concurrently: the
    // second may be stored before the first.
    await w.service.appendLog(w.host, frame(5, "BBBBB"));
    await w.service.appendLog(w.host, frame(0, "AAAAA"));
    await w.service.appendLog(w.host, frame(10, "C\n"));
    // A replay of the first, after a reconnect: held already.
    await w.service.appendLog(w.host, frame(0, "AAAAA"));
    expect((await w.service.readLog(job.id)).stdout).toBe("AAAAABBBBBC\n");
    expect(
      await w.repos.logs.findMany({ where: { jobId: { eq: job.id } } }),
    ).toHaveLength(3);

    await w.commands.ack(w.host.id, { id: command.id, status: "done" });
    expect((await w.service.readLog(job.id)).stdout).toBe("AAAAABBBBBC\n");
  });

  it("logs each kind of line the transcript cannot read once, at the job's end, with a short sample (#Q4296)", async ({
    expect,
  }) => {
    const logged: { message: string; data: any }[] = [];
    w.alepha.events.on("log:entry", ({ entry }) => {
      if (entry.level === "ERROR")
        logged.push({ message: String(entry.message), data: entry.data });
    });
    const job = await start(w);
    const command = await commandOf(w, job.id);
    const odd = (n: number) => JSON.stringify({ type: "odd_event", n });
    await w.service.appendLog(w.host, {
      type: "log",
      id: command.id,
      stream: "stdout",
      offset: 0,
      data: `${odd(1)}\n${odd(2)}\n${"x".repeat(500)}\n`,
    });
    await w.commands.ack(w.host.id, { id: command.id, status: "running" });
    expect(logged).toEqual([]);
    await w.commands.ack(w.host.id, { id: command.id, status: "done" });

    expect(logged.map((it) => it.message)).toEqual([
      "Agent transcript row not supported: odd_event",
      "Agent transcript row not supported: unparsable",
    ]);
    expect(logged[0]?.data).toMatchObject({
      jobId: job.id,
      kind: "odd_event",
      count: 2,
      sample: odd(1),
    });
    expect(String(logged[1]?.data.sample)).toHaveLength(200);
  });

  it("names the model a run took by default once it ended, from its agent CLI's init line (#Q4304)", async ({
    expect,
  }) => {
    const job = await start(w);
    const command = await commandOf(w, job.id);
    await w.service.appendLog(w.host, {
      type: "log",
      id: command.id,
      stream: "stdout",
      offset: 0,
      data: `${JSON.stringify({ type: "system", subtype: "init", model: "m-default" })}\n`,
    });
    // While it runs, nothing reads its log for a model.
    const running = await w.repos.jobs.getOne({
      where: { id: { eq: job.id } },
    });
    expect(await w.service.modelOf(running)).toBe(undefined);

    await w.commands.ack(w.host.id, { id: command.id, status: "done" });
    const ended = await w.repos.jobs.getOne({ where: { id: { eq: job.id } } });
    expect(await w.service.modelOf(ended)).toBe("m-default");
    // The run's own model wins over the log's.
    expect(
      await w.service.modelOf({
        ...ended,
        input: { ...(ended.input as object), model: "m-named" },
      } as typeof ended),
    ).toBe("m-named");
  });

  it("stores what a run cost from its terminal ack, a failed run's too, and nothing from an older Bay (#Q4293)", async ({
    expect,
  }) => {
    const job = await start(w);
    const command = await commandOf(w, job.id);
    await w.commands.ack(w.host.id, {
      id: command.id,
      status: "failed",
      reason: "the agent exited with status 1",
      totals: {
        turns: 7,
        inputTokens: 48_120,
        outputTokens: 2_100,
        costUsd: 0.4213,
      },
    });
    const ended = await w.repos.jobs.getOne({ where: { id: { eq: job.id } } });
    expect(ended).toMatchObject({
      status: "failed",
      turns: 7,
      inputTokens: 48_120,
      outputTokens: 2_100,
      costUsd: 0.4213,
    });

    const older = await start(w);
    const olderCommand = await commandOf(w, older.id);
    await w.commands.ack(w.host.id, { id: olderCommand.id, status: "done" });
    const plain = await w.repos.jobs.getOne({
      where: { id: { eq: older.id } },
    });
    expect(plain.turns ?? null).toBe(null);
    expect(plain.costUsd ?? null).toBe(null);
  });

  it("ignores a log frame for another host's command", async ({ expect }) => {
    const job = await start(w);
    const command = await commandOf(w, job.id);
    const other = { ...w.host, id: "00000000-0000-4000-8000-00000000beef" };
    await w.service.appendLog(other, {
      type: "log",
      id: command.id,
      stream: "stdout",
      offset: 0,
      data: "forged",
    });
    expect((await w.service.readLog(job.id)).stdout).toBe("");
  });

  it("cancels a queued job at once and a running one through its host", async ({
    expect,
  }) => {
    const running = await start(w);
    const queued = await start(w);
    const cancelled = await w.service.cancel(queued.id);
    expect(cancelled.status).toBe("cancelled");

    await w.service.cancel(running.id);
    const cancels = await w.repos.commands.findMany({
      where: { kind: { eq: "job-cancel" } },
    });
    expect(cancels).toHaveLength(1);
    const command = await commandOf(w, running.id);
    expect(cancels[0]?.payload.jobCommandId).toBe(command.id);
    await w.commands.ack(w.host.id, { id: command.id, status: "cancelled" });
    const ended = await w.repos.jobs.getOne({
      where: { id: { eq: running.id } },
    });
    expect(ended.status).toBe("cancelled");
  });

  it("mints the job key at the spec pull, then on the end emits host:job:ended and revokes it", async ({
    expect,
  }) => {
    const port = w.alepha.inject(HostJobs);
    const ended: string[] = [];
    w.alepha.events.on("host:job:ended", ({ job }) => {
      ended.push(job.status);
    });
    const job = await port.start({
      projectId: w.projectId,
      hostId: w.host.id,
      kind: "agent",
      input: { ...input, key: { feedbackId: 4 } },
      startedBy: w.ownerId,
    });
    const row = await w.repos.jobs.getOne({ where: { id: { eq: job.id } } });
    const spec = await w.service.spec(row, "https://lore.test");
    expect(spec).toMatchObject({
      kind: "agent",
      agent: "claude",
      mcpUrl: "https://lore.test/mcp",
      workspace: "triage",
    });
    // Bay's adapter builds the command line: none of Claude's vocabulary
    // travels (#Q4219).
    for (const gone of [
      "profile",
      "maxTurns",
      "allowedTools",
      "disallowedTools",
      "permissionMode",
      "egress",
      "image",
    ]) {
      expect(spec).not.toHaveProperty(gone);
    }
    // The project's directory on the host is its slug (#Q4218).
    expect(spec.project).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
    expect(spec).not.toHaveProperty("repository");
    expect(String(spec.key)).toMatch(/^ak_lorejob_/);
    const command = await commandOf(w, job.id);
    await w.commands.ack(w.host.id, { id: command.id, status: "failed" });
    expect(ended).toEqual(["failed"]);
    const keys = await w.repos.keys.findMany({
      where: { jobId: { eq: job.id } },
    });
    expect(keys).toHaveLength(1);
    expect(keys[0]?.revokedAt).toBeDefined();
  });

  it("walks the chain a job was started by", async ({ expect }) => {
    const parent = await start(w);
    const check = await w.service.start({
      projectId: w.projectId,
      hostId: w.host.id,
      kind: "check",
      input: { timeoutSeconds: 60 },
      startedByJobId: parent.id,
    });
    expect(await w.service.chainHolds(check.id, "agent")).toBe(true);
    expect(await w.service.chainHolds(parent.id, "check")).toBe(false);
  });

  it("sends a check its agent and model, and nothing in reach (#Q4219)", async ({
    expect,
  }) => {
    const check = await w.service.start({
      projectId: w.projectId,
      hostId: w.host.id,
      kind: "check",
      input: {
        timeoutSeconds: 60,
        agent: "gemini",
        model: "gemini-2.5-pro",
      },
    });
    const row = await w.repos.jobs.getOne({ where: { id: { eq: check.id } } });
    const spec = await w.service.spec(row, "https://lore.test");
    expect(spec).toEqual({
      kind: "check",
      agent: "gemini",
      model: "gemini-2.5-pro",
      timeoutSeconds: 60,
    });
  });
});
