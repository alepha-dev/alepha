import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AgentJobGitHub,
  GitHubTransport,
  HostCommandService,
  HostCommandTransport,
  HostJobService,
} from "@lore/core/api";
import {
  hostJobs,
  hosts,
  projectRepositories,
  projects,
} from "@lore/core/schemas";
import { MemoryGitHubTransport } from "@lore/core/testing";
import { createTestHost } from "@lore/core/testing/hosts";
import { AgentHostService, AgentJobService } from "@lore/prompts/api";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import { TestEntityRepositories } from "./fixtures/entities.ts";

class ConnectedTransport extends HostCommandTransport {
  override async push(): Promise<boolean> {
    return true;
  }
}

class Repos {
  jobs = $repository(hostJobs);
  hosts = $repository(hosts);
  projects = $repository(projects);
  repositories = $repository(projectRepositories);
}

const pkcs1 = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

const setup = async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "lore-agent-job-github-"));
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      DATA_DIR: dataDir,
      APP_SECRET: "a-strong-unique-secret-for-the-agent-job-github-spec",
      GITHUB_APP_ID: "4242",
      GITHUB_APP_SLUG: "lore-acme",
      GITHUB_APP_CLIENT_ID: "Iv1.acme",
      GITHUB_APP_CLIENT_SECRET: "client-secret",
      GITHUB_APP_WEBHOOK_SECRET: "webhook-secret",
      GITHUB_APP_PRIVATE_KEY: pkcs1,
    },
  });
  alepha.with({ provide: HostCommandTransport, use: ConnectedTransport });
  alepha.with({ provide: GitHubTransport, use: MemoryGitHubTransport });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  bootLore(alepha);
  const entities = alepha.inject(TestEntityRepositories);
  const repos = alepha.inject(Repos);
  await alepha.start();
  const github = alepha.inject(MemoryGitHubTransport);
  const dateTime = alepha.inject(DateTimeProvider);
  let minted = 0;
  github.on(
    "POST",
    /^\/app\/installations\/(\d+)\/access_tokens$/,
    (request, m) => {
      if (m[1] === "404") {
        return { status: 404, json: { message: "Not Found" } };
      }
      minted++;
      const body = JSON.parse(String(request.body ?? "{}"));
      return {
        status: 201,
        json: {
          token: `ghs_jobtoken${minted}_abcdefghijklmnopqrstuvwxyz`,
          expires_at: new Date(dateTime.nowMillis() + 3_600_000).toISOString(),
          permissions: body.permissions,
          repository_selection: "selected",
        },
      };
    },
  );
  github.on("GET", /^\/users\/lore-acme\[bot\]$/, {
    json: { id: 123456, login: "lore-acme[bot]" },
  });
  const user = await entities.users.create({});
  const owner: UserAccountToken = { id: user.id, roles: ["user"] };
  const host = await createTestHost(alepha, owner, { slug: "agent-1" });
  return {
    alepha,
    dataDir,
    repos,
    github,
    owner,
    host,
    base: alepha.inject(NodeHttpServerProvider).hostname,
    agents: alepha.inject(AgentHostService),
    service: alepha.inject(AgentJobService),
    hostRows: alepha.inject(HostJobService),
    commands: alepha.inject(HostCommandService),
  };
};

type World = Awaited<ReturnType<typeof setup>>;

/**
 * An Agent host whose Bay prepares sources and runs job tokens, its jobs
 * user's gh signed out, for a project on github.com/acme/web.
 */
const prepare = async (w: World, options: { tokens?: boolean } = {}) => {
  await w.repos.hosts.updateById(w.host.id, { jobsAllowed: true });
  const row = await w.repos.hosts.getOne({ where: { id: { eq: w.host.id } } });
  await w.agents.setAgentHost(row, true);
  const [check] = await w.repos.jobs.findMany({
    where: { kind: { eq: "check" } },
  });
  if (check?.commandId) {
    await w.commands.ack(w.host.id, { id: check.commandId, status: "done" });
  }
  await w.repos.hosts.updateById(w.host.id, {
    jobsSources: true,
    jobsGitHubTokens: options.tokens ?? true,
    jobsUser: "bay-agent",
    jobsTools: [
      { name: "claude", kind: "agent", found: true, version: "2.1.7" },
      { name: "gh", kind: "tool", found: true, signedIn: false },
    ],
  });
  await w.repos.projects.updateById(w.host.projectId, {
    repositoryUrl: "https://github.com/acme/web",
  });
};

const connect = async (w: World, installationId = 7) => {
  await w.repos.repositories.create({
    projectId: w.host.projectId,
    installationId,
    repositoryId: 101,
    owner: "acme",
    name: "web",
    defaultBranch: "main",
    connectedAt: new Date().toISOString(),
  });
};

const run = (w: World, extra: Record<string, unknown> = {}) =>
  w.service.start({
    projectId: w.host.projectId,
    prompt: "Triage feedback 4.",
    feedbackNumber: 4,
    startedBy: w.owner.id,
    subjectType: "feedback",
    subjectId: "4",
    ...extra,
  });

const rowOf = (w: World, id: string) =>
  w.repos.jobs.getOne({ where: { id: { eq: id } } });

/**
 * An agent job's GitHub token (#Q4365, epic #E177): minted for the
 * project's connected repository when the host pulls the spec, with the
 * permission set its source asks for, renewed while it runs, and no gh
 * sign-in needed on the host.
 */
describe("an agent job's GitHub token", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });
  afterEach(async () => {
    await w.alepha.stop();
    await rm(w.dataDir, { recursive: true, force: true });
  });

  it("starts a read job on a host whose gh is signed out, and its spec carries a read token for the one repository", async ({
    expect,
  }) => {
    await prepare(w);
    await connect(w);
    const job = await run(w);
    expect(job.input.source).toEqual({ mode: "read" });
    const spec = await w.hostRows.spec(
      await rowOf(w, job.id),
      "https://lore.test",
    );
    expect(spec.github).toEqual({
      token: expect.stringMatching(/^ghs_jobtoken1_/),
      expiresAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/),
      botName: "lore-acme[bot]",
      botEmail: "123456+lore-acme[bot]@users.noreply.github.com",
    });
    const [mint] = w.github.sent(
      "POST",
      /^\/app\/installations\/7\/access_tokens$/,
    );
    expect(JSON.parse(String(mint?.body))).toEqual({
      repository_ids: [101],
      permissions: AgentJobGitHub.JOB_READ,
    });
    // Lore records which credential, never the token.
    const row = await rowOf(w, job.id);
    expect(row.input.credential).toBe("app");
    expect(JSON.stringify(row)).not.toContain("ghs_");
  });

  it("gives a write job contents write and nothing more", async ({
    expect,
  }) => {
    await prepare(w);
    await connect(w);
    const job = await run(w, {
      questNumber: 12,
      feedbackNumber: undefined,
      defaultSource: "write",
    });
    await w.hostRows.spec(await rowOf(w, job.id), "https://lore.test");
    const [mint] = w.github.sent("POST", /access_tokens$/);
    expect(JSON.parse(String(mint?.body)).permissions).toEqual({
      contents: "write",
      pull_requests: "write",
      checks: "read",
      actions: "read",
      statuses: "read",
      metadata: "read",
    });
  });

  it("still refuses a signed-out host for a project not connected, or on a Bay without job tokens", async ({
    expect,
  }) => {
    await prepare(w);
    await expect(run(w)).rejects.toThrow("gh CLI signed out");
    await connect(w);
    await w.repos.hosts.updateById(w.host.id, { jobsGitHubTokens: false });
    await expect(run(w)).rejects.toThrow("gh CLI signed out");
  });

  it("sends no token to a Bay that does not run them, and records the host's login", async ({
    expect,
  }) => {
    await prepare(w);
    await connect(w);
    await w.repos.hosts.updateById(w.host.id, {
      jobsTools: [
        { name: "claude", kind: "agent", found: true, version: "2.1.7" },
        { name: "gh", kind: "tool", found: true, signedIn: true },
      ],
      jobsGitHubTokens: false,
    });
    const job = await run(w);
    const spec = await w.hostRows.spec(
      await rowOf(w, job.id),
      "https://lore.test",
    );
    expect(spec.github).toBeUndefined();
    expect(w.github.sent("POST", /access_tokens$/)).toHaveLength(0);
    expect((await rowOf(w, job.id)).input.credential).toBe("host");
  });

  it("falls back to the host's login when GitHub refuses the token", async ({
    expect,
  }) => {
    await prepare(w);
    await connect(w, 404);
    const job = await run(w);
    const spec = await w.hostRows.spec(
      await rowOf(w, job.id),
      "https://lore.test",
    );
    expect(spec.github).toBeUndefined();
    expect((await rowOf(w, job.id)).input.credential).toBe("host");
  });

  it("renews a running job's token over its command, for its host only, and refuses once it ended", async ({
    expect,
  }) => {
    await prepare(w);
    await connect(w);
    const job = await run(w);
    let row = await rowOf(w, job.id);
    await w.hostRows.spec(row, "https://lore.test");
    row = await rowOf(w, job.id);
    expect(row.status).toBe("running");
    expect(row.commandId).toBeTruthy();
    // Bay acks its job-run running, as it does before it starts the agent.
    await w.commands.ack(w.host.id, {
      id: row.commandId as string,
      status: "running",
    });
    const renew = (secret?: string) =>
      fetch(`${w.base}/estates/commands/${row.commandId}/github-token`, {
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
      });
    const ok = await renew(w.host.secret);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const body = (await ok.json()) as Record<string, unknown>;
    // An hour left: the token it holds.
    expect(body.token).toMatch(/^ghs_jobtoken1_/);
    expect(body.botName).toBe("lore-acme[bot]");
    // Ten minutes left, when Bay asks: a new one, never the one it holds.
    await w.alepha.inject(DateTimeProvider).travel(50, "minutes");
    const again = await renew(w.host.secret);
    const fresh = (await again.json()) as { token: string };
    expect(again.status).toBe(200);
    expect(fresh.token).toMatch(/^ghs_jobtoken2_/);
    // No bearer, no token.
    expect((await renew()).status).toBe(401);
    // Another host's bearer: not its command.
    const other = await createTestHost(
      w.alepha,
      w.owner,
      { slug: "agent-2" },
      { projectId: w.host.projectId },
    );
    expect((await renew(other.secret)).status).toBe(404);
    // Ended: refused.
    await w.repos.jobs.updateById(job.id, { status: "succeeded" });
    expect((await renew(w.host.secret)).status).toBe(404);
  });
});
