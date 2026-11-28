import { generateKeyPairSync } from "node:crypto";

import {
  GitHubTransport,
  GitHubWebhookHandlers,
  type GitHubWebhookContext,
} from "@lore/core/api";
import { jobKeys, projectRepositories } from "@lore/core/schemas";
import { MemoryGitHubTransport } from "@lore/core/testing";
import { WorkflowController } from "@lore/ship/api";
import { workflowDispatches } from "@lore/ship/schemas";
import { Alepha } from "alepha";
import { audits } from "alepha/api/audits";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import {
  AlephaSecurity,
  currentUserAtom,
  type UserAccountToken,
} from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestMember,
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

class Rows {
  repositories = $repository(projectRepositories);
  dispatches = $repository(workflowDispatches);
  keys = $repository(jobKeys);
  audits = $repository(audits);
}

const pkcs1 = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

const RELEASE = `name: Release
on:
  workflow_dispatch:
    inputs:
      dry_run:
        description: Build and check, publish nothing
        type: boolean
        default: true
      bump:
        type: choice
        required: true
        options: [patch, minor, major]
      note:
        type: string
jobs:
  release:
    runs-on: ubuntu-latest
    steps: []
`;

const VERIFY = `name: Verify
on: [push, pull_request]
jobs: {}
`;

const DEPLOY = `name: Deploy
on: workflow_dispatch
jobs: {}
`;

/**
 * Starting a GitHub workflow from Lore (#Q4366): the dispatchable
 * workflows and their inputs, a dispatch checked against them, re-run and
 * cancel, the permission, the activity, the job key's refusal, and the
 * run matched to the request that started it.
 */
const setup = async () => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      APP_SECRET: "a-strong-unique-secret-for-the-github-workflows-spec",
      GITHUB_APP_ID: "4242",
      GITHUB_APP_SLUG: "lore-acme",
      GITHUB_APP_CLIENT_ID: "Iv1.acme",
      GITHUB_APP_CLIENT_SECRET: "client-secret",
      GITHUB_APP_WEBHOOK_SECRET: "webhook-secret",
      GITHUB_APP_PRIVATE_KEY: pkcs1,
    },
  });
  alepha.with({ provide: GitHubTransport, use: MemoryGitHubTransport });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaMcp);
  bootLore(alepha, ["api", "mcp"]);
  const entities = alepha.inject(TestEntityRepositories);
  const rows = alepha.inject(Rows);
  await alepha.start();

  const project = await createTestProject(alepha, { title: "Acme web" });
  const owner: UserAccountToken = {
    id: project.createdBy!,
    roles: ["user"],
  };
  const github = alepha.inject(MemoryGitHubTransport);
  let minted = 0;
  github.on("POST", /^\/app\/installations\/7\/access_tokens$/, (request) => {
    minted++;
    const body = JSON.parse(String(request.body ?? "{}"));
    return {
      status: 201,
      json: {
        token: `ghs_token${minted}`,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        permissions: body.permissions,
      },
    };
  });
  github.on("GET", /^\/repos\/acme\/web\/actions\/workflows$/, {
    json: {
      total_count: 4,
      workflows: [
        {
          id: 11,
          name: "Release",
          path: ".github/workflows/release.yml",
          state: "active",
        },
        {
          id: 12,
          name: "Verify",
          path: ".github/workflows/verify.yml",
          state: "active",
        },
        {
          id: 13,
          name: "Deploy",
          path: ".github/workflows/deploy.yml",
          state: "active",
        },
        {
          id: 14,
          name: "Old",
          path: ".github/workflows/old.yml",
          state: "disabled_manually",
        },
      ],
    },
  });
  const file = (text: string) => ({
    json: { content: Buffer.from(text).toString("base64"), encoding: "base64" },
  });
  github.on(
    "GET",
    /^\/repos\/acme\/web\/contents\/.github\/workflows\/release.yml$/,
    file(RELEASE),
  );
  github.on(
    "GET",
    /^\/repos\/acme\/web\/contents\/.github\/workflows\/verify.yml$/,
    file(VERIFY),
  );
  github.on(
    "GET",
    /^\/repos\/acme\/web\/contents\/.github\/workflows\/deploy.yml$/,
    file(DEPLOY),
  );
  github.on("GET", /^\/repos\/acme\/web\/actions\/runs$/, {
    json: {
      workflow_runs: [
        {
          id: 501,
          workflow_id: 11,
          name: "Release",
          head_branch: "main",
          event: "workflow_dispatch",
          status: "completed",
          conclusion: "failure",
          html_url: "https://github.com/acme/web/actions/runs/501",
          created_at: "2026-11-28T10:05:00Z",
          actor: { login: "lore-acme[bot]" },
        },
      ],
    },
  });
  github.on(
    "POST",
    /^\/repos\/acme\/web\/actions\/workflows\/(\d+)\/dispatches$/,
    { status: 204 },
  );
  github.on(
    "POST",
    /^\/repos\/acme\/web\/actions\/runs\/(\d+)\/(rerun|rerun-failed-jobs|cancel)$/,
    { status: 201 },
  );

  const connect = async () =>
    await rows.repositories.create({
      id: crypto.randomUUID(),
      projectId: project.id,
      installationId: 7,
      repositoryId: 101,
      owner: "acme",
      name: "web",
      defaultBranch: "main",
      connectedBy: project.createdBy,
      connectedAt: "2026-11-28T10:00:00.000Z",
    });
  const api = alepha.inject(WorkflowController);
  const as = (user: UserAccountToken) => ({ user });
  const run = (payload: Record<string, unknown>, action = "requested") => {
    const context = {
      delivery: crypto.randomUUID(),
      event: "workflow_run",
      action,
      installationId: 7,
      payload: { workflow_run: payload },
    };
    return context;
  };
  const handle = async (context: Record<string, unknown>) => {
    const connection = (await rows.repositories.findMany({}))[0];
    for (const handler of alepha
      .inject(GitHubWebhookHandlers)
      .handlersOf("workflow_run")) {
      await handler.handle({
        ...context,
        connection,
      } as unknown as GitHubWebhookContext);
    }
  };
  return {
    alepha,
    entities,
    rows,
    project,
    owner,
    github,
    connect,
    api,
    as,
    run,
    handle,
  };
};

describe("GitHub workflows from Lore", () => {
  it("lists the active workflows that declare workflow_dispatch, with their inputs, and the recent runs", async ({
    expect,
  }) => {
    const w = await setup();
    await w.connect();
    const it = (
      await w.api.getWorkflows.fetch(
        { params: { projectId: w.project.id } },
        w.as(w.owner),
      )
    ).data;
    expect(it.connected).toBe(true);
    expect(it.repository).toBe("acme/web");
    expect(it.workflows.map((wf) => wf.name)).toEqual(["Release", "Deploy"]);
    expect(it.workflows[0].inputs).toEqual([
      {
        name: "dry_run",
        description: "Build and check, publish nothing",
        required: false,
        type: "boolean",
        default: "true",
      },
      {
        name: "bump",
        required: true,
        type: "choice",
        options: ["patch", "minor", "major"],
      },
      { name: "note", required: false, type: "string" },
    ]);
    expect(it.workflows[1].inputs).toEqual([]);
    expect(it.runs).toEqual([
      expect.objectContaining({
        id: 501,
        conclusion: "failure",
        workflowId: 11,
      }),
    ]);
  });

  it("says a project not connected is not, and refuses to start anything there", async ({
    expect,
  }) => {
    const w = await setup();
    const it = (
      await w.api.getWorkflows.fetch(
        { params: { projectId: w.project.id } },
        w.as(w.owner),
      )
    ).data;
    expect(it).toEqual({ connected: false, workflows: [], runs: [] });
    await expect(
      w.api.dispatchWorkflow.fetch(
        {
          params: { projectId: w.project.id },
          body: { workflowId: 11, ref: "main" },
        },
        w.as(w.owner),
      ),
    ).rejects.toThrow("not connected to GitHub");
  });

  it("dispatches with checked inputs on an actions:write token, writes the activity, and links the run GitHub starts", async ({
    expect,
  }) => {
    const w = await setup();
    await w.connect();
    const dispatch = (inputs: Record<string, string>) =>
      w.api.dispatchWorkflow.fetch(
        {
          params: { projectId: w.project.id },
          body: { workflowId: 11, ref: "main", inputs },
        },
        w.as(w.owner),
      );
    await expect(dispatch({ bump: "patch", shell: "x" })).rejects.toThrow(
      'has no input "shell"',
    );
    await expect(dispatch({ note: "hi" })).rejects.toThrow(
      'needs its input "bump"',
    );
    await expect(dispatch({ bump: "huge" })).rejects.toThrow(
      "is one of: patch, minor, major",
    );
    await expect(dispatch({ bump: "minor", dry_run: "yes" })).rejects.toThrow(
      "is true or false",
    );
    expect(w.github.sent("POST", /dispatches$/)).toHaveLength(0);

    const { id } = (await dispatch({ bump: "minor", dry_run: "true" })).data;
    const [sent] = w.github.sent("POST", /\/workflows\/11\/dispatches$/);
    expect(JSON.parse(String(sent.body))).toEqual({
      ref: "main",
      inputs: { bump: "minor", dry_run: "true" },
    });
    const mints = w.github
      .sent("POST", /access_tokens$/)
      .map((it) => JSON.parse(String(it.body)).permissions);
    expect(mints).toContainEqual({ actions: "write" });

    const [audit] = await w.rows.audits.findMany({
      where: { type: { eq: "github" }, action: { eq: "dispatch" } },
    });
    expect(audit).toMatchObject({
      userId: w.owner.id,
      resourceType: "github-workflow",
      resourceId: "11",
      description: "Release on main",
      metadata: {
        ref: "main",
        inputs: { bump: "minor", dry_run: "true" },
        dispatchId: id,
      },
    });

    // A push run of the same workflow is not it; the dispatch run is.
    const requestedAt = (await w.rows.dispatches.findById(id))!.requestedAt;
    const later = new Date(Date.parse(requestedAt) + 5_000).toISOString();
    await w.handle(
      w.run({
        id: 700,
        workflow_id: 11,
        event: "push",
        head_branch: "main",
        status: "queued",
        created_at: later,
        html_url: "https://github.com/acme/web/actions/runs/700",
      }),
    );
    expect((await w.rows.dispatches.findById(id))!.runId).toBeUndefined();
    await w.handle(
      w.run({
        id: 701,
        workflow_id: 11,
        event: "workflow_dispatch",
        head_branch: "main",
        status: "queued",
        created_at: later,
        html_url: "https://github.com/acme/web/actions/runs/701",
      }),
    );
    expect(await w.rows.dispatches.findById(id)).toMatchObject({
      runId: 701,
      runStatus: "queued",
      runUrl: "https://github.com/acme/web/actions/runs/701",
    });
    await w.handle(
      w.run(
        {
          id: 701,
          workflow_id: 11,
          event: "workflow_dispatch",
          head_branch: "main",
          status: "completed",
          conclusion: "success",
          created_at: later,
        },
        "completed",
      ),
    );
    expect(await w.rows.dispatches.findById(id)).toMatchObject({
      runId: 701,
      runStatus: "completed",
      runConclusion: "success",
    });
  });

  it("re-runs a run, its failed jobs, and cancels one, each on the activity", async ({
    expect,
  }) => {
    const w = await setup();
    await w.connect();
    const params = { projectId: w.project.id, runId: 501 };
    await w.api.rerunWorkflowRun.fetch(
      { params, body: { failedOnly: true } },
      w.as(w.owner),
    );
    await w.api.rerunWorkflowRun.fetch({ params, body: {} }, w.as(w.owner));
    await w.api.cancelWorkflowRun.fetch({ params }, w.as(w.owner));
    expect(
      w.github
        .sent("POST", /\/actions\/runs\/501\//)
        .map((it) => new URL(it.url).pathname.split("/").pop()),
    ).toEqual(["rerun-failed-jobs", "rerun", "cancel"]);
    const rows = await w.rows.audits.findMany({
      where: { type: { eq: "github" }, resourceId: { eq: "501" } },
    });
    expect(rows.map((it) => it.action).sort()).toEqual([
      "cancel",
      "rerun",
      "rerun",
    ]);
  });

  it("refuses a member without deploy:workflow, and an agent job's key whatever its rank", async ({
    expect,
  }) => {
    const w = await setup();
    await w.connect();
    const user = await w.entities.users.create({});
    await createTestMember(w.alepha, w.project, user.id, { rank: "member" });
    const member: UserAccountToken = { id: user.id, roles: ["user"] };
    // A member reads the section, and starts nothing.
    await w.api.getWorkflows.fetch(
      { params: { projectId: w.project.id } },
      w.as(member),
    );
    await expect(
      w.api.dispatchWorkflow.fetch(
        {
          params: { projectId: w.project.id },
          body: { workflowId: 13, ref: "main" },
        },
        w.as(member),
      ),
    ).rejects.toThrow();

    // The owner's own job key: refused all the same.
    const apiKeyId = crypto.randomUUID();
    await w.rows.keys.create({
      apiKeyId,
      jobId: crypto.randomUUID(),
      projectId: w.project.id,
      userId: w.owner.id,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const job = {
      ...w.owner,
      credential: { type: "api-key", id: apiKeyId },
    } as UserAccountToken;
    // As `workflow_run` calls it under the key: the action itself, in the
    // MCP request that carries the key.
    const underKey = <R>(fn: () => Promise<R>): Promise<R> =>
      w.alepha.context.run(() => {
        w.alepha.store.set(currentUserAtom, job);
        w.alepha.store.set("alepha.http.request", { user: job } as never);
        return fn();
      });
    await expect(
      underKey(() =>
        w.api.dispatchWorkflow({
          params: { projectId: w.project.id },
          body: { workflowId: 13, ref: "main" },
        }),
      ),
    ).rejects.toThrow("An agent job cannot start");
    await expect(
      underKey(() =>
        w.api.cancelWorkflowRun({
          params: { projectId: w.project.id, runId: 501 },
        }),
      ),
    ).rejects.toThrow("An agent job cannot start");
    expect(w.github.sent("POST", /dispatches$|cancel$/)).toHaveLength(0);
  });
});
