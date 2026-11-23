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
import { LoreShipApi } from "@lore/ship/api";
import { DeployTestEntities } from "@lore/ship/testing";
// Its own subpath: `./testing` is loaded by browser specs, and this one
// boots the host controllers (#E166).
import { createTestHost } from "@lore/ship/testing/hosts";
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
  profile: "read" as const,
  repository: { cloneUrl: "https://lore.test/acme.git", ref: "main" },
  prompt: "Triage the inbox.",
  maxTurns: 30,
  timeoutSeconds: 900,
  allowedTools: ["Read"],
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
      input: { ...input, key: { tools: ["feedback_get"] } },
      startedBy: w.ownerId,
    });
    const row = await w.repos.jobs.getOne({ where: { id: { eq: job.id } } });
    const spec = await w.service.spec(row, "https://lore.test");
    expect(spec).toMatchObject({
      kind: "agent",
      profile: "read",
      mcpUrl: "https://lore.test/mcp",
      repository: input.repository,
    });
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
      input: { profile: "check", maxTurns: 1, timeoutSeconds: 60 },
      startedByJobId: parent.id,
    });
    expect(await w.service.chainHolds(check.id, "agent")).toBe(true);
    expect(await w.service.chainHolds(parent.id, "check")).toBe(false);
  });

  it("queues a paused job again once its window has passed", async ({
    expect,
  }) => {
    const job = await start(w);
    const command = await commandOf(w, job.id);
    await w.commands.ack(w.host.id, { id: command.id, status: "failed" });
    await w.service.pause(job.id, "2000-01-01T00:00:00.000Z", "usage limit");
    await w.service.sweep();
    const again = await w.repos.jobs.getOne({ where: { id: { eq: job.id } } });
    expect(again.status).toBe("running");
    expect(again.retries).toBe(1);
  });

  it("lets a check reach the Anthropic API and nothing else", async ({
    expect,
  }) => {
    const check = await w.service.start({
      projectId: w.projectId,
      hostId: w.host.id,
      kind: "check",
      input: { profile: "check", maxTurns: 1, timeoutSeconds: 60 },
    });
    const row = await w.repos.jobs.getOne({ where: { id: { eq: check.id } } });
    const spec = await w.service.spec(row, "https://lore.test");
    expect(spec.egress).toEqual(["api.anthropic.com"]);
    expect(spec.mcpUrl).toBeUndefined();
  });

  it("pins the agent image this Lore was deployed with, by digest only (#Q3997)", async ({
    expect,
  }) => {
    const digest = `ghcr.io/alepha-dev/lore-agent@sha256:${"a".repeat(64)}`;
    const pinned = await setup({ AGENT_IMAGE: digest });
    const job = await start(pinned);
    const row = await pinned.repos.jobs.getOne({
      where: { id: { eq: job.id } },
    });
    expect((await pinned.service.spec(row, "https://lore.test")).image).toBe(
      digest,
    );
    const check = await pinned.service.start({
      projectId: pinned.projectId,
      hostId: pinned.host.id,
      kind: "check",
      input: { profile: "check", maxTurns: 1, timeoutSeconds: 60 },
    });
    const checkRow = await pinned.repos.jobs.getOne({
      where: { id: { eq: check.id } },
    });
    expect(
      (await pinned.service.spec(checkRow, "https://lore.test")).image,
    ).toBe(digest);

    const tagged = await setup({
      AGENT_IMAGE: "ghcr.io/alepha-dev/lore-agent:latest",
    });
    const other = await start(tagged);
    const otherRow = await tagged.repos.jobs.getOne({
      where: { id: { eq: other.id } },
    });
    expect(
      (await tagged.service.spec(otherRow, "https://lore.test")).image,
    ).toBeUndefined();
  });
});
