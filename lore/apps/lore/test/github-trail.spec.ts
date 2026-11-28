import { generateKeyPairSync } from "node:crypto";

import {
  GitHubDeliveryService,
  GitHubTransport,
  GitHubWebhookSignature,
  ProjectEventCatalogService,
  projectEvents,
  PullRequestController,
  PullRequestStateService,
} from "@lore/core/api";
import {
  githubDeliveries,
  jobKeys,
  projectRepositories,
  pullRequests,
} from "@lore/core/schemas";
import { MemoryGitHubTransport } from "@lore/core/testing";
import { QuestController } from "@lore/plan/api";
import { quests } from "@lore/plan/schemas";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestEpic,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

class Rows {
  deliveries = $repository(githubDeliveries);
  keys = $repository(jobKeys);
  repositories = $repository(projectRepositories);
  pullRequests = $repository(pullRequests);
  quests = $repository(quests);
  events = $repository(projectEvents);
}

const SECRET = "webhook-secret";

const pkcs1 = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

const REPO = {
  id: 101,
  full_name: "acme/web",
  name: "web",
  owner: { login: "acme" },
};

/**
 * Commits and pull requests attach themselves to their quests and carry
 * GitHub's state (#Q4367), driven by signed deliveries over HTTP.
 */
const setup = async () => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      APP_SECRET: "a-strong-unique-secret-for-the-github-trail-spec",
      GITHUB_APP_ID: "4242",
      GITHUB_APP_SLUG: "lore-acme",
      GITHUB_APP_CLIENT_ID: "Iv1.acme",
      GITHUB_APP_CLIENT_SECRET: "client-secret",
      GITHUB_APP_WEBHOOK_SECRET: SECRET,
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
  alepha.inject(TestEntityRepositories);
  const rows = alepha.inject(Rows);
  await alepha.start();

  const project = await createTestProject(alepha, { title: "Acme web" });
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
  const quest5 = await createTestQuest(alepha, project, { shortId: 5 });
  const quest7 = await createTestQuest(alepha, project, { shortId: 7 });
  const quest12 = await createTestQuest(alepha, project, { shortId: 12 });
  const epic = await createTestEpic(alepha, project, { number: 3 });

  // The team, by default: every author writes to the repository, and the
  // App's bot is `lore-acme[bot]`. A case narrows it with its own route.
  const github = alepha.inject(MemoryGitHubTransport);
  github.on("POST", /^\/app\/installations\/7\/access_tokens$/, {
    status: 201,
    json: {
      token: "ghs_team",
      expires_at: "2099-01-01T00:00:00Z",
      permissions: {},
    },
  });
  github.on("GET", /^\/repos\/acme\/web\/collaborators\/([^/]+)\/permission$/, {
    json: { permission: "write", role_name: "write" },
  });
  github.on("GET", /^\/users\/lore-acme\[bot\]$/, {
    json: { id: 123456, login: "lore-acme[bot]" },
  });
  const url = `${alepha.inject(NodeHttpServerProvider).hostname}/api/github/webhook`;
  const signer = alepha.inject(GitHubWebhookSignature);
  const states = alepha.inject(PullRequestStateService);
  let n = 0;
  const deliver = async (event: string, payload: Record<string, unknown>) => {
    const body = JSON.stringify({
      installation: { id: 7 },
      repository: REPO,
      ...payload,
    });
    const delivery = `d-${++n}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        "x-github-delivery": delivery,
        "x-hub-signature-256": await signer.sign(body, SECRET),
      },
      body,
    });
    if (response.status !== 202) {
      throw new Error(`Delivery refused: ${response.status}`);
    }
    // Handle it here, or wait for the deferred task that claimed it.
    await alepha.inject(GitHubDeliveryService).handle(delivery);
    for (let i = 0; i < 200; i++) {
      const [row] = await rows.deliveries.findMany({
        where: { id: { eq: delivery } },
      });
      if (row && row.status !== "pending" && row.status !== "handling") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const pr = (over: Record<string, unknown> = {}) => ({
    id: 9001,
    number: 118,
    title: "Fix the login redirect (#Q5)",
    body: "",
    state: "open",
    draft: false,
    merged: false,
    html_url: "https://github.com/acme/web/pull/118",
    user: { login: "alice", id: 555 },
    head: { ref: "fix/login", sha: "a".repeat(40) },
    base: { ref: "main" },
    ...over,
  });
  const row = async () =>
    (await rows.pullRequests.findMany({ where: { number: { eq: 118 } } }))[0];
  const questOf = async (id: number) => await rows.quests.findById(id);
  const added = async () =>
    (
      await rows.events.findMany({
        where: { name: { eq: "pull_request.added" } },
      })
    ).length;
  return {
    alepha,
    rows,
    project,
    quest5,
    quest7,
    quest12,
    epic,
    deliver,
    pr,
    row,
    questOf,
    added,
    states,
    github,
  };
};

describe("pull requests from GitHub", () => {
  it("attaches a pull request naming #Q5 to the quest, with its state, once", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.deliver("pull_request", {
      action: "opened",
      pull_request: ctx.pr(),
    });
    expect(await ctx.row()).toMatchObject({
      state: "open",
      checks: "pending",
      review: "none",
      title: "Fix the login redirect (#Q5)",
      headRef: "fix/login",
    });
    const quest = await ctx.questOf(ctx.quest5.id);
    expect(quest!.pullRequests).toEqual([
      expect.objectContaining({
        url: "https://github.com/acme/web/pull/118",
        number: 118,
        source: "github",
      }),
    ]);
    expect(await ctx.added()).toBe(1);

    // An edit, a redelivery, and the hand-written tool: still one record,
    // still one event.
    await ctx.deliver("pull_request", {
      action: "edited",
      pull_request: ctx.pr(),
    });
    await ctx.alepha.inject(QuestController).addQuestPullRequest.fetch(
      {
        params: { id: ctx.quest5.id },
        body: { url: "https://github.com/acme/web/pull/118", number: 118 },
      },
      { user: { id: ctx.project.createdBy!, roles: ["user"] } },
    );
    expect((await ctx.questOf(ctx.quest5.id))!.pullRequests).toHaveLength(1);
    expect(await ctx.added()).toBe(1);
  });

  it("reads #E3 and a lore/q7 branch, never a bare #12", async ({ expect }) => {
    const ctx = await setup();
    await ctx.deliver("pull_request", {
      action: "opened",
      pull_request: ctx.pr({
        title: "Part of #E3, see #12",
        head: { ref: "lore/q7", sha: "b".repeat(40) },
      }),
    });
    expect((await ctx.questOf(ctx.quest7.id))!.pullRequests).toHaveLength(1);
    expect(
      (await ctx.questOf(ctx.quest12.id))!.pullRequests ?? [],
    ).toHaveLength(0);
    expect((await ctx.questOf(ctx.quest5.id))!.pullRequests ?? []).toHaveLength(
      0,
    );
  });

  it("follows draft, ready, merged and closed", async ({ expect }) => {
    const ctx = await setup();
    await ctx.deliver("pull_request", {
      action: "opened",
      pull_request: ctx.pr({ draft: true }),
    });
    expect((await ctx.row())!.state).toBe("draft");
    await ctx.deliver("pull_request", {
      action: "ready_for_review",
      pull_request: ctx.pr(),
    });
    expect((await ctx.row())!.state).toBe("open");
    await ctx.deliver("pull_request", {
      action: "enqueued",
      pull_request: ctx.pr(),
    });
    expect((await ctx.row())!.queued).toBe(true);
    await ctx.deliver("pull_request", {
      action: "closed",
      pull_request: ctx.pr({
        state: "closed",
        merged: true,
        merged_at: "2026-11-28T12:00:00Z",
      }),
    });
    expect(await ctx.row()).toMatchObject({ state: "merged", queued: false });

    const other = await setup();
    await other.deliver("pull_request", {
      action: "opened",
      pull_request: other.pr(),
    });
    await other.deliver("pull_request", {
      action: "closed",
      pull_request: other.pr({ state: "closed" }),
    });
    expect((await other.row())!.state).toBe("closed");
  });

  it("rolls up checks: red, then a new head resets to pending, then green; a failing status counts", async ({
    expect,
  }) => {
    const ctx = await setup();
    const head = "a".repeat(40);
    await ctx.deliver("pull_request", {
      action: "opened",
      pull_request: ctx.pr(),
    });
    await ctx.deliver("check_run", {
      action: "completed",
      check_run: {
        id: 1,
        name: "test",
        head_sha: head,
        status: "completed",
        conclusion: "failure",
        html_url: "https://github.com/acme/web/actions/runs/1",
        check_suite: { id: 10 },
      },
    });
    await ctx.deliver("check_suite", {
      action: "completed",
      check_suite: {
        id: 10,
        head_sha: head,
        status: "completed",
        conclusion: "failure",
      },
    });
    expect(await ctx.row()).toMatchObject({
      checks: "failing",
      failingChecks: [
        {
          id: 1,
          name: "test",
          url: "https://github.com/acme/web/actions/runs/1",
        },
      ],
    });

    const next = "c".repeat(40);
    await ctx.deliver("pull_request", {
      action: "synchronize",
      pull_request: ctx.pr({ head: { ref: "fix/login", sha: next } }),
    });
    expect(await ctx.row()).toMatchObject({
      checks: "pending",
      failingChecks: [],
    });
    await ctx.deliver("check_suite", {
      action: "completed",
      check_suite: {
        id: 11,
        head_sha: next,
        status: "completed",
        conclusion: "success",
      },
    });
    expect((await ctx.row())!.checks).toBe("passing");

    await ctx.deliver("status", {
      sha: next,
      context: "ci/legacy",
      state: "failure",
    });
    expect((await ctx.row())!.checks).toBe("failing");
    await ctx.deliver("status", {
      sha: next,
      context: "ci/legacy",
      state: "success",
    });
    expect((await ctx.row())!.checks).toBe("passing");
  });

  it("answers the state beside the records a quest carries, and nothing for another repository", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.deliver("pull_request", {
      action: "opened",
      pull_request: ctx.pr(),
    });
    const states = (
      await ctx.alepha.inject(PullRequestController).getPullRequestStates.fetch(
        {
          params: { projectId: ctx.project.id },
          body: {
            urls: [
              "https://github.com/acme/web/pull/118",
              "https://github.com/other/repo/pull/118",
            ],
          },
        },
        { user: { id: ctx.project.createdBy!, roles: ["user"] } },
      )
    ).data.items;
    expect(states).toEqual([
      expect.objectContaining({
        url: "https://github.com/acme/web/pull/118",
        state: "open",
        checks: "pending",
        outside: false,
      }),
    ]);
  });

  it("attaches commits pushed to the default branch to the quests they name, only there", async ({
    expect,
  }) => {
    const ctx = await setup();
    const commit = (sha: string, message: string) => ({ id: sha, message });
    await ctx.deliver("push", {
      ref: "refs/heads/feature",
      commits: [commit("1".repeat(40), "wip #Q5")],
    });
    expect((await ctx.questOf(ctx.quest5.id))!.commits ?? []).toHaveLength(0);
    await ctx.deliver("push", {
      ref: "refs/heads/main",
      commits: [
        commit("2".repeat(40), "fix(web): the login redirect #Q5\n\nBody #Q12"),
        commit("3".repeat(40), "chore: nothing"),
      ],
    });
    expect((await ctx.questOf(ctx.quest5.id))!.commits).toEqual([
      expect.objectContaining({
        sha: "2".repeat(40),
        message: "fix(web): the login redirect #Q5",
        repo: "acme/web",
        source: "github",
      }),
    ]);
    expect((await ctx.questOf(ctx.quest12.id))!.commits).toHaveLength(1);
    // Redelivered: the same trail.
    await ctx.deliver("push", {
      ref: "refs/heads/main",
      commits: [commit("2".repeat(40), "fix(web): the login redirect #Q5")],
    });
    expect((await ctx.questOf(ctx.quest5.id))!.commits).toHaveLength(1);
  });

  it("backfills open and recently merged pull requests at connect, attaching with no event", async ({
    expect,
  }) => {
    const ctx = await setup();
    ctx.github.on("POST", /^\/app\/installations\/7\/access_tokens$/, {
      status: 201,
      json: {
        token: "ghs_x",
        expires_at: "2099-01-01T00:00:00Z",
        permissions: {},
      },
    });
    ctx.github.on("GET", /^\/repos\/acme\/web\/pulls$/, (request) =>
      new URL(request.url).searchParams.get("state") === "open"
        ? { json: [ctx.pr()] }
        : {
            json: [
              ctx.pr({
                id: 9002,
                number: 117,
                title: "Old #Q7",
                state: "closed",
                merged_at: new Date().toISOString(),
                html_url: "https://github.com/acme/web/pull/117",
              }),
            ],
          },
    );
    const [connection] = await ctx.rows.repositories.findMany({});
    expect(await ctx.states.backfill(connection)).toBe(2);
    expect((await ctx.questOf(ctx.quest5.id))!.pullRequests).toHaveLength(1);
    expect((await ctx.questOf(ctx.quest7.id))!.pullRequests).toHaveLength(1);
    expect(await ctx.added()).toBe(0);
  });
});

describe("pull request and CI events", () => {
  const names = async (ctx: Awaited<ReturnType<typeof setup>>) =>
    (
      await ctx.rows.events.findMany({
        where: { name: { startsWith: "pull_request." } },
        orderBy: [{ column: "occurredAt", direction: "asc" }],
      })
    )
      .map((it) => it.name)
      .filter((it) => it !== "pull_request.added");

  it("raises each transition once, never on a repeated delivery", async ({
    expect,
  }) => {
    const ctx = await setup();
    const head = "a".repeat(40);
    await ctx.deliver("pull_request", {
      action: "opened",
      pull_request: ctx.pr({ draft: true }),
    });
    await ctx.deliver("pull_request", {
      action: "opened",
      pull_request: ctx.pr({ draft: true }),
    });
    await ctx.deliver("pull_request", {
      action: "ready_for_review",
      pull_request: ctx.pr(),
    });
    await ctx.deliver("pull_request", {
      action: "review_requested",
      pull_request: ctx.pr(),
    });
    await ctx.deliver("pull_request_review", {
      action: "submitted",
      review: { state: "APPROVED", author_association: "MEMBER" },
      pull_request: ctx.pr(),
    });
    const suite = (conclusion: string) => ({
      action: "completed",
      check_suite: { id: 10, head_sha: head, status: "completed", conclusion },
    });
    await ctx.deliver("check_suite", suite("failure"));
    await ctx.deliver("check_suite", suite("failure"));
    await ctx.deliver("check_suite", suite("success"));
    await ctx.deliver("pull_request", {
      action: "closed",
      pull_request: ctx.pr({ state: "closed", merged: true }),
    });
    expect(await names(ctx)).toEqual([
      "pull_request.opened",
      "pull_request.ready",
      "pull_request.review_requested",
      "pull_request.reviewed",
      "pull_request.checks_failed",
      "pull_request.checks_passed",
      "pull_request.merged",
    ]);
    const [opened] = await ctx.rows.events.findMany({
      where: { name: { eq: "pull_request.opened" } },
    });
    expect(opened.subjectId).toBe("118");
    expect(opened.fields).toMatchObject({
      number: 118,
      quest_shortId: 5,
      head_ref: "fix/login",
      outside: false,
    });
  });

  it("marks a pull request from outside the team, and a member's trust raises pull_request.trusted once", async ({
    expect,
  }) => {
    const ctx = await setup();
    ctx.github.on("POST", /^\/app\/installations\/7\/access_tokens$/, {
      status: 201,
      json: {
        token: "ghs_x",
        expires_at: "2099-01-01T00:00:00Z",
        permissions: {},
      },
    });
    ctx.github.on(
      "GET",
      /^\/repos\/acme\/web\/collaborators\/([^/]+)\/permission$/,
      {
        json: { permission: "read", role_name: "read" },
      },
    );
    await ctx.deliver("pull_request", {
      action: "opened",
      pull_request: ctx.pr(),
    });
    const [opened] = await ctx.rows.events.findMany({
      where: { name: { eq: "pull_request.opened" } },
    });
    expect(opened.fields.outside).toBe(true);

    const api = ctx.alepha.inject(PullRequestController);
    const user = { id: ctx.project.createdBy!, roles: ["user"] };
    const trusted = (
      await api.trustPullRequest.fetch(
        { params: { projectId: ctx.project.id, number: 118 } },
        { user },
      )
    ).data;
    expect(trusted).toMatchObject({ outside: false });
    await api.trustPullRequest.fetch(
      { params: { projectId: ctx.project.id, number: 118 } },
      { user },
    );
    expect(
      (await names(ctx)).filter((it) => it === "pull_request.trusted"),
    ).toHaveLength(1);
  });

  it("raises workflow_run.failed on the default branch only", async ({
    expect,
  }) => {
    const ctx = await setup();
    const run = (branch: string, conclusion: string) => ({
      action: "completed",
      workflow_run: {
        id: Math.floor(Math.random() * 1e6),
        name: "Verify",
        conclusion,
        head_branch: branch,
        html_url: "https://github.com/acme/web/actions/runs/1",
        head_sha: "a".repeat(40),
      },
    });
    await ctx.deliver("workflow_run", run("feature", "failure"));
    await ctx.deliver("workflow_run", run("main", "success"));
    await ctx.deliver("workflow_run", run("main", "failure"));
    const failed = await ctx.rows.events.findMany({
      where: { name: { eq: "workflow_run.failed" } },
    });
    expect(failed).toHaveLength(1);
    expect(failed[0].fields).toMatchObject({
      branch: "main",
      workflow: "Verify",
    });
  });

  it("holds what it cannot place: an unread permission is outside, and so is the quest it names", async ({
    expect,
  }) => {
    const ctx = await setup();
    ctx.github.on(
      "GET",
      /^\/repos\/acme\/web\/collaborators\/([^/]+)\/permission$/,
      { status: 502, json: { message: "Bad gateway" } },
    );
    await ctx.deliver("pull_request", {
      action: "opened",
      pull_request: ctx.pr(),
    });
    const events = await ctx.rows.events.findMany({
      where: {
        name: { inArray: ["pull_request.opened", "pull_request.added"] },
      },
    });
    expect(
      events
        .map((it) => [it.name, it.fields.outside])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ["pull_request.added", true],
      ["pull_request.opened", true],
    ]);
    // GitHub answers on the next delivery: the permission is read again.
    ctx.github.on(
      "GET",
      /^\/repos\/acme\/web\/collaborators\/([^/]+)\/permission$/,
      { json: { permission: "write" } },
    );
    await ctx.deliver("pull_request", {
      action: "edited",
      pull_request: ctx.pr(),
    });
    expect((await ctx.row())!.authorPermission).toBe("write");
  });

  it("moves the review only on a review by someone with a say on the repository", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.deliver("pull_request", {
      action: "opened",
      pull_request: ctx.pr(),
    });
    await ctx.deliver("pull_request_review", {
      action: "submitted",
      review: { state: "APPROVED", author_association: "NONE" },
      pull_request: ctx.pr(),
    });
    expect((await ctx.row())!.review).toBe("none");
    await ctx.deliver("pull_request_review", {
      action: "submitted",
      review: { state: "APPROVED", author_association: "COLLABORATOR" },
      pull_request: ctx.pr(),
    });
    expect((await ctx.row())!.review).toBe("approved");
  });

  it("never takes a fork's branch or a fork's run for the repository's own", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.deliver("pull_request", {
      action: "opened",
      pull_request: ctx.pr({
        title: "Some change",
        head: {
          ref: "lore/q7",
          label: "stranger:lore/q7",
          sha: "b".repeat(40),
          repo: { id: 999, full_name: "stranger/web" },
        },
      }),
    });
    expect((await ctx.row())!.headRef).toBe("stranger:lore/q7");
    expect((await ctx.questOf(ctx.quest7.id))!.pullRequests ?? []).toEqual([]);
    await ctx.deliver("workflow_run", {
      action: "completed",
      workflow_run: {
        id: 77,
        name: "Verify",
        conclusion: "failure",
        head_branch: "main",
        head_repository: { id: 999 },
        html_url: "https://github.com/acme/web/actions/runs/77",
        head_sha: "b".repeat(40),
      },
    });
    expect(
      await ctx.rows.events.findMany({
        where: { name: { eq: "workflow_run.failed" } },
      }),
    ).toHaveLength(0);
  });

  it("refuses an agent job's key the trust of a pull request", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.deliver("pull_request", {
      action: "opened",
      pull_request: ctx.pr(),
    });
    const apiKeyId = crypto.randomUUID();
    await ctx.rows.keys.create({
      apiKeyId,
      jobId: crypto.randomUUID(),
      projectId: ctx.project.id,
      userId: ctx.project.createdBy!,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const job = {
      id: ctx.project.createdBy!,
      roles: ["user"],
      credential: { type: "api-key", id: apiKeyId },
    };
    await expect(
      ctx.alepha.context.run(() => {
        ctx.alepha.store.set(currentUserAtom, job as never);
        ctx.alepha.store.set("alepha.http.request", { user: job } as never);
        return ctx.alepha.inject(PullRequestController).trustPullRequest({
          params: { projectId: ctx.project.id, number: 118 },
        });
      }),
    ).rejects.toThrow("An agent job cannot trust");
  });

  it("lists the events only for a connected project", async ({ expect }) => {
    const ctx = await setup();
    const catalog = ctx.alepha.inject(ProjectEventCatalogService);
    const listed = async () =>
      (await catalog.describe(ctx.project.id)).map((it) => it.name);
    expect(await listed()).toEqual(
      expect.arrayContaining([
        "pull_request.opened",
        "pull_request.checks_failed",
        "workflow_run.failed",
        "pull_request.added",
      ]),
    );
    await ctx.rows.repositories.deleteMany({});
    const after = await listed();
    expect(after).not.toContain("pull_request.opened");
    expect(after).not.toContain("workflow_run.failed");
    // Recorded on a quest by hand: not GitHub's, so it stays.
    expect(after).toContain("pull_request.added");
  });
});
