import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  HostCommandService,
  HostCommandTransport,
  HostJobService,
} from "@lore/core/api";
import { hostJobs, hosts, jobKeys } from "@lore/core/schemas";
import { createTestHost } from "@lore/core/testing/hosts";
import { AgentHostService, PromptController } from "@lore/prompts/api";
import {
  ProjectErrorController,
  ProjectErrorThreadController,
} from "@lore/ship/api";
import { projectErrors } from "@lore/ship/schemas";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestMemberByProjectId,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

/**
 * "Ask an agent" on an error (#Q4471): `investigate-error` run on a host,
 * and what the job's own key may then do over MCP. The agent is played
 * here: each case mints the job's real key from its spec and makes the
 * calls the prompt asks for, through the HTTP transport an agent uses.
 */
class ConnectedTransport extends HostCommandTransport {
  override async push(): Promise<boolean> {
    return true;
  }
}

class Repos {
  jobs = $repository(hostJobs);
  hosts = $repository(hosts);
  errors = $repository(projectErrors);
  keys = $repository(jobKeys);
}

const MESSAGE = "Cannot read properties of undefined (reading 'items')";

const setup = async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "lore-investigate-"));
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      DATA_DIR: dataDir,
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
  const repos = alepha.inject(Repos);
  await alepha.start();
  const user = await entities.users.create({});
  const owner: UserAccountToken = { id: user.id, roles: ["user"] };
  const host = await createTestHost(alepha, owner, { slug: "agent-1" });
  await repos.hosts.updateById(host.id, {
    jobsAllowed: true,
    jobsTools: [
      { name: "claude", kind: "agent", found: true, version: "2.1.7" },
    ],
  });
  await alepha
    .inject(AgentHostService)
    .setAgentHost(
      await repos.hosts.getOne({ where: { id: { eq: host.id } } }),
      true,
    );
  const [check] = await repos.jobs.findMany({
    where: { kind: { eq: "check" } },
  });
  if (check?.commandId) {
    await alepha
      .inject(HostCommandService)
      .ack(host.id, { id: check.commandId, status: "done" });
  }
  const projectId = host.projectId;
  const file = (over: Record<string, unknown> = {}) =>
    repos.errors.create({
      projectId,
      fingerprint: `fp-${crypto.randomUUID()}`,
      name: "TypeError",
      message: MESSAGE,
      stack: "TypeError\n    at cart (app.js:1:1)",
      sourceUrl: "https://acme.example/cart",
      origin: "server",
      count: 7,
      firstSeenAt: "2026-08-01T10:00:00.000Z",
      lastSeenAt: "2026-08-01T10:05:00.000Z",
      trustedAt: "2026-08-01T10:00:00.000Z",
      ...over,
    } as never);
  return {
    alepha,
    dataDir,
    entities,
    repos,
    owner,
    projectId,
    file,
    baseUrl: alepha.inject(NodeHttpServerProvider).hostname,
    prompts: alepha.inject(PromptController),
    errors: alepha.inject(ProjectErrorController),
    thread: alepha.inject(ProjectErrorThreadController),
  };
};

type World = Awaited<ReturnType<typeof setup>>;

/**
 * One MCP call with a token: the tool's answer, or the refusal's text.
 */
const mcp = async (w: World, token: string, name: string, args: object) => {
  const response = await fetch(`${w.baseUrl}/mcp`, {
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
  const answer = (await response.json()) as {
    result?: { isError?: boolean; content?: Array<{ text?: string }> };
    error?: { message?: string };
  };
  const text =
    answer.result?.content?.map((part) => part.text ?? "").join("") ??
    answer.error?.message ??
    "";
  return { failed: !!answer.error || !!answer.result?.isError, text };
};

const investigate = (
  w: World,
  errorId: number,
  user: UserAccountToken = w.owner,
) =>
  w.prompts.runPrompt.run(
    {
      params: { projectId: w.projectId, name: "investigate-error" },
      body: { args: { error: String(errorId) } } as never,
    },
    { user },
  );

const jobOf = (w: World, jobId: string) =>
  w.repos.jobs.getOne({ where: { id: { eq: jobId } } });

/**
 * The job's own key, as its machine receives it when it pulls the spec.
 */
const keyOf = async (w: World, jobId: string) =>
  String(
    (
      await w.alepha
        .inject(HostJobService)
        .spec(await jobOf(w, jobId), w.baseUrl)
    ).key,
  );

const threadOf = (w: World, errorId: number) =>
  w.thread.listProjectErrorThread.run(
    { params: { projectId: w.projectId, errorId } },
    { user: w.owner },
  );

describe("investigate-error: asking an agent about one error", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });
  afterEach(async () => {
    await w.alepha.stop();
    await rm(w.dataDir, { recursive: true, force: true });
  });

  it("files the run under the error, pins its key to it, and keeps the error's text out of the prompt and the job's record", async ({
    expect,
  }) => {
    const error = await w.file();
    const run = await investigate(w, error.id);
    const job = await jobOf(w, String(run.jobId));

    expect(job).toMatchObject({
      subjectType: "error",
      subjectId: String(error.id),
      prompt: "investigate-error",
      args: [
        {
          name: "error",
          type: "error",
          value: String(error.id),
          reference: `Error ${error.id}`,
          title: "Server error",
        },
      ],
    });
    expect(job.input.key).toEqual({ errorId: error.id });
    expect(job.input.source?.mode).not.toBe("write");
    expect(job.input.prompt).toContain(
      `Your Lore key reaches error ${error.id} only`,
    );
    expect(job.input.prompt).toContain(`error_id ${error.id}`);
    // The owner may triage, and the project plans its work in Lore.
    expect(job.input.prompt).toContain("step 3 applies when a fix is needed");
    // Whoever reaches the application writes this text: never in a prompt.
    expect(job.input.prompt).not.toContain(MESSAGE);
    expect(JSON.stringify(job.args)).not.toContain("TypeError");

    await keyOf(w, String(run.jobId));
    const [pin] = await w.repos.keys.findMany({
      where: { jobId: { eq: String(run.jobId) } },
    });
    expect(pin?.errorId).toBe(error.id);
  });

  it("shows the run on the error's thread while it has not answered, and its answer as an agent's comment", async ({
    expect,
  }) => {
    const error = await w.file();
    const run = await investigate(w, error.id);
    const jobId = String(run.jobId);
    // Dispatched at once to the connected host: queued or already running.
    const [going] = (await threadOf(w, error.id)).jobs;
    expect(going).toMatchObject({ id: jobId, prompt: "investigate-error" });
    expect(["queued", "running"]).toContain(going?.status);

    const key = await keyOf(w, jobId);
    const read = await mcp(w, key, "error_get", {
      project: w.projectId,
      error_id: error.id,
    });
    expect(read.failed).toBe(false);
    expect(read.text).toContain(MESSAGE);
    const said = await mcp(w, key, "error_comment_add", {
      project: w.projectId,
      error_id: error.id,
      body: "The cart is read before it loads: `cart.items` in `app.js`.",
      as: "claude",
    });
    expect(said.failed).toBe(false);

    const thread = await threadOf(w, error.id);
    expect(thread.entries).toMatchObject([
      {
        type: "comment",
        body: "The cart is read before it loads: `cart.items` in `app.js`.",
        source: { kind: "mcp", client: "claude" },
      },
    ]);

    // A run that ended well shows nothing more: its comment does. One that
    // failed stays, since nothing else says it was asked.
    await w.repos.jobs.updateById(jobId, { status: "succeeded" });
    expect((await threadOf(w, error.id)).jobs).toEqual([]);
    await w.repos.jobs.updateById(jobId, { status: "failed" });
    expect((await threadOf(w, error.id)).jobs).toMatchObject([
      { id: jobId, status: "failed" },
    ]);
    await w.repos.jobs.updateById(jobId, { status: "cancelled" });
    expect((await threadOf(w, error.id)).jobs).toEqual([]);
  });

  it("refuses the key on any other error, for the four tools that name one, and still lists the inbox", async ({
    expect,
  }) => {
    const error = await w.file();
    const other = await w.file();
    const run = await investigate(w, error.id);
    const key = await keyOf(w, String(run.jobId));
    const refusal = `This job key reaches error ${error.id} only`;

    for (const [tool, args] of [
      ["error_get", {}],
      ["error_comment_add", { body: "Elsewhere" }],
      ["error_resolve", {}],
      ["error_forward", {}],
    ] as const) {
      const answer = await mcp(w, key, tool, {
        project: w.projectId,
        error_id: other.id,
        ...args,
      });
      expect(answer.failed, tool).toBe(true);
      expect(answer.text, tool).toContain(refusal);
    }
    const untouched = await w.repos.errors.getOne({
      where: { id: { eq: other.id } },
    });
    expect(untouched.status).toBe("open");
    expect((await threadOf(w, other.id)).entries).toEqual([]);

    const list = await mcp(w, key, "error_list", { project: w.projectId });
    expect(list.failed).toBe(false);
  });

  it("forwards to a new quest carrying the finding when the member who asked may triage", async ({
    expect,
  }) => {
    const error = await w.file();
    const run = await investigate(w, error.id);
    const key = await keyOf(w, String(run.jobId));

    const created = await mcp(w, key, "quest_create", {
      project: w.projectId,
      title: "The cart is read before it loads",
      description: "Cause: `cart.items` is read in `app.js` before the fetch.",
      area: "Errors",
      priority: "medium",
    });
    expect(created.failed, created.text).toBe(false);
    const shortId = Number(
      (JSON.parse(created.text) as { shortId: number }).shortId,
    );
    const forwarded = await mcp(w, key, "error_forward", {
      project: w.projectId,
      error_id: error.id,
      quest_shortId: shortId,
    });
    expect(forwarded.failed, forwarded.text).toBe(false);

    const row = await w.repos.errors.getOne({
      where: { id: { eq: error.id } },
    });
    expect(row.status).toMatch(/^quest:\d+$/);
    const detail = await w.errors.getProjectError.run(
      { params: { projectId: w.projectId, errorId: error.id } },
      { user: w.owner },
    );
    expect(detail.quest).toMatchObject({
      shortId,
      title: "The cart is read before it loads",
    });
    expect(
      (await threadOf(w, error.id)).entries.map((entry) => entry.kind),
    ).toEqual(["linked"]);
  });

  it("leaves a comment only when the member who asked may not triage: the prompt says so, and the forward is refused", async ({
    expect,
  }) => {
    const created = await w.entities.users.create({});
    const member: UserAccountToken = { id: created.id, roles: ["user"] };
    await createTestMemberByProjectId(w.alepha, w.projectId, member.id);
    const error = await w.file();

    const run = await investigate(w, error.id, member);
    const job = await jobOf(w, String(run.jobId));
    expect(job.input.prompt).toContain("may not triage errors: skip step 3");
    expect(job.input.prompt).not.toContain("step 3 applies");

    const key = await keyOf(w, String(run.jobId));
    const said = await mcp(w, key, "error_comment_add", {
      project: w.projectId,
      error_id: error.id,
      body: "A fix is needed; a member who may triage can forward this.",
    });
    expect(said.failed, said.text).toBe(false);
    const forwarded = await mcp(w, key, "error_forward", {
      project: w.projectId,
      error_id: error.id,
    });
    expect(forwarded.failed).toBe(true);
    expect(forwarded.text).toContain("error:triage");
    const resolved = await mcp(w, key, "error_resolve", {
      project: w.projectId,
      error_id: error.id,
    });
    expect(resolved.failed).toBe(true);

    const row = await w.repos.errors.getOne({
      where: { id: { eq: error.id } },
    });
    expect(row.status).toBe("open");
    expect((await threadOf(w, error.id)).entries).toHaveLength(1);
  });

  it("tells a run on a forwarded error to name its quest and file none", async ({
    expect,
  }) => {
    const error = await w.file();
    await w.errors.forwardProjectErrorToQuest.run(
      { params: { projectId: w.projectId, errorId: error.id }, body: {} },
      { user: w.owner },
    );
    const run = await investigate(w, error.id);
    const job = await jobOf(w, String(run.jobId));
    expect(job.input.prompt).toContain("already forwarded to a quest");
    expect(job.input.prompt).not.toContain("step 3 applies");
  });

  it("refuses an untrusted error: the run, the render, and the arg's select", async ({
    expect,
  }) => {
    const untrusted = await w.file({ origin: "client", trustedAt: undefined });
    const trusted = await w.file();

    await expect(investigate(w, untrusted.id)).rejects.toThrow(
      `Error ${untrusted.id} is not trusted`,
    );
    await expect(
      w.prompts.renderPrompt.run(
        {
          params: { projectId: w.projectId, name: "investigate-error" },
          body: { args: { error: String(untrusted.id) } } as never,
        },
        { user: w.owner },
      ),
    ).rejects.toThrow(`Error ${untrusted.id} is not trusted`);
    expect(
      await w.repos.jobs.findMany({ where: { kind: { eq: "agent" } } }),
    ).toEqual([]);

    const { items } = await w.prompts.listPromptArgOptions.run(
      {
        params: {
          projectId: w.projectId,
          name: "investigate-error",
          arg: "error",
        },
      },
      { user: w.owner },
    );
    expect(items.map((item) => item.value)).toEqual([String(trusted.id)]);
  });

  it("is pinned to the error's view, and takes no error of another project", async ({
    expect,
  }) => {
    const prompt = await w.prompts.getPrompt.run(
      { params: { projectId: w.projectId, name: "investigate-error" } },
      { user: w.owner },
    );
    expect(prompt).toMatchObject({
      builtin: true,
      pins: ["error"],
      permission: "error:read",
      source: "read",
      args: [{ name: "error", type: "error" }],
    });
    const { pages } = await w.prompts.listPrompts.run(
      { params: { projectId: w.projectId } },
      { user: w.owner },
    );
    expect(pages).toContainEqual({
      key: "error",
      label: "Error view",
      gives: "error",
    });
    await expect(investigate(w, 999_999)).rejects.toThrow("no error 999999");
  });
});
